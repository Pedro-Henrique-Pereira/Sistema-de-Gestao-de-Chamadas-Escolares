from __future__ import annotations

import json
import socket
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from automacao.config.settings import settings


class AutomationApiError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


@dataclass(frozen=True)
class EntregaAutomacao:
    id: int
    canal: str
    mensagem: str
    tentativa: int
    telefone: str | None = None
    nome_grupo: str | None = None
    nome_grupo_busca: str | None = None


@dataclass(frozen=True)
class TarefaAutomacao:
    id: int
    api_version: int
    tipo: str
    status: str
    entregas: tuple[EntregaAutomacao, ...]
    resumo: dict[str, int]


def mascarar_telefone(valor: str | None) -> str:
    digits = "".join(char for char in str(valor or "") if char.isdigit())
    if len(digits) < 4:
        return "***"
    return f"{digits[:2]}*******{digits[-2:]}"


def codigo_erro_seguro(exc: BaseException) -> str:
    if isinstance(exc, AutomationApiError) and exc.status:
        return f"API_{exc.status}"
    texto = f"{type(exc).__name__} {exc}".lower()
    if "grupo" in texto and ("cabecalho" in texto or "cabe\u00e7alho" in texto):
        return "GROUP_VALIDATION_FAILED"
    if "grupo" in texto and ("n\u00e3o encontr" in texto or "nao encontr" in texto):
        return "GROUP_NOT_FOUND"
    if "destinat" in texto and ("não encontr" in texto or "nao encontr" in texto):
        return "RECIPIENT_NOT_FOUND"
    if "telefone" in texto or "phone" in texto:
        return "INVALID_PHONE"
    if "timeout" in texto or "timed out" in texto:
        return "TIMEOUT"
    if "webdriver" in texto or "chrome" in texto or "firefox" in texto:
        return "WEBDRIVER_ERROR"
    if "connection" in texto or "network" in texto or "internet" in texto:
        return "NETWORK_ERROR"
    nome = type(exc).__name__.upper()
    return "".join(char if char.isalnum() else "_" for char in nome)[:80] or "FALHA_ENVIO"


class AutomationApiClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        token: str | None = None,
        timeout_seconds: int | None = None,
        worker_id: str | None = None,
        machine_id: int | None = None,
        transport: Callable[..., tuple[int, dict[str, Any]]] | None = None,
    ) -> None:
        self.base_url = (base_url or settings.api_base_url).rstrip("/")
        self.machine_id = machine_id if machine_id is not None else settings.numero_maquina
        self._token = token if token is not None else settings.token_for_machine(self.machine_id)
        self.timeout_seconds = timeout_seconds or settings.api_timeout_seconds
        self.worker_id = worker_id or settings.worker_id
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Lysimaco-Automacao/2",
            "X-Automation-Machine": str(self.machine_id),
        }

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._transport is not None:
            status, data = self._transport(method, path, payload)
            return self._validar_resposta(status, data)

        body = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers=self._headers(),
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8")
                data = json.loads(raw) if raw else {}
                return self._validar_resposta(response.status, data)
        except HTTPError as exc:
            try:
                data = json.loads(exc.read().decode("utf-8"))
            except Exception:
                data = {}
            return self._validar_resposta(exc.code, data)
        except (URLError, TimeoutError, socket.timeout) as exc:
            raise AutomationApiError(
                "Não foi possível conectar à API do sistema de chamadas.",
                retryable=True,
            ) from exc

    @staticmethod
    def _validar_resposta(status: int, data: dict[str, Any]) -> dict[str, Any]:
        if 200 <= status < 300:
            if not isinstance(data, dict):
                raise AutomationApiError("Resposta inválida da API.", status=status)
            return data
        mensagem = str(data.get("erro") or "Falha ao comunicar com a API.")
        raise AutomationApiError(
            mensagem,
            status=status,
            retryable=status == 429 or status >= 500,
        )

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/api/automation-worker/health")

    def heartbeat(
        self,
        state: str = "online_available",
        *,
        current_task_id: int | None = None,
        last_error_code: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "worker_id": self.worker_id,
            "app_version": settings.app_version,
            "state": state,
            "current_task_id": current_task_id,
        }
        if last_error_code:
            payload["last_error_code"] = last_error_code[:80]
        return self._request("POST", "/api/automation-worker/heartbeat", payload)

    def capturar_tarefa(self) -> TarefaAutomacao | None:
        data = self._request(
            "POST",
            "/api/automation-worker/tasks/claim",
            {"worker_id": self.worker_id},
        )
        tarefa = data.get("tarefa")
        if tarefa is None:
            return None
        if not isinstance(tarefa, dict):
            raise AutomationApiError("Contrato de tarefa inválido.")

        entregas = []
        for item in tarefa.get("entregas") or []:
            if not isinstance(item, dict):
                raise AutomationApiError("Contrato de entrega inválido.")
            canal = str(item.get("canal") or "")
            if canal not in {"responsavel", "grupo"}:
                raise AutomationApiError("Canal de entrega não suportado.")
            entregas.append(
                EntregaAutomacao(
                    id=int(item["id"]),
                    canal=canal,
                    mensagem=str(item.get("mensagem") or ""),
                    tentativa=int(item.get("tentativa") or 1),
                    telefone=str(item.get("telefone") or "") or None,
                    nome_grupo=str(item.get("nome_grupo") or "") or None,
                    nome_grupo_busca=str(item.get("nome_grupo_busca") or "") or None,
                )
            )

        api_version = int(tarefa.get("api_version") or 1)
        if api_version > 2:
            raise AutomationApiError(
                "A tarefa usa uma versÃ£o de contrato mais nova que este aplicativo.",
                retryable=False,
            )

        return TarefaAutomacao(
            id=int(tarefa["id"]),
            api_version=api_version,
            tipo=str(tarefa.get("tipo") or "faltas"),
            status=str(tarefa.get("status") or "executando"),
            entregas=tuple(entregas),
            resumo=dict(tarefa.get("resumo") or {}),
        )

    def registrar_resultado(
        self,
        entrega_id: int,
        status: str,
        erro_codigo: str | None = None,
        external_id: str | None = None,
    ) -> dict[str, Any]:
        if status not in {"enviado", "erro", "ignorado"}:
            raise ValueError("Status de resultado inválido.")
        payload = {
            "worker_id": self.worker_id,
            "status": status,
        }
        if erro_codigo:
            payload["erro_codigo"] = erro_codigo[:80]
        if external_id:
            payload["external_id"] = external_id[:100]
        return self._request(
            "POST",
            f"/api/automation-worker/deliveries/{int(entrega_id)}/result",
            payload,
        )


class ReceiptJournal:
    """Checkpoint local mínimo para fechar a janela entre envio e confirmação na API.

    O arquivo contém somente IDs técnicos e status, nunca telefone, mensagem ou token.
    """

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or (Path(__file__).resolve().parents[2] / "runtime" / "delivery-receipts.json")

    def _load(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                return []
            return [
                item
                for item in data
                if isinstance(item, dict)
                and isinstance(item.get("entrega_id"), int)
                and item.get("status") in {"enviado", "ignorado"}
            ]
        except (OSError, json.JSONDecodeError):
            return []

    def _save(self, items: list[dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.path)

    def record(
        self,
        entrega_id: int,
        status: str,
        external_id: str | None = None,
    ) -> None:
        if status not in {"enviado", "ignorado"}:
            raise ValueError("O journal aceita apenas resultados finais sem reenvio.")
        items = self._load()
        if not any(item["entrega_id"] == int(entrega_id) for item in items):
            items.append({
                "entrega_id": int(entrega_id),
                "status": status,
                "external_id": external_id or f"local-{uuid.uuid4()}",
            })
            self._save(items)

    def pending_count(self) -> int:
        return len(self._load())

    def flush(self, client: AutomationApiClient) -> int:
        items = self._load()
        remaining = []
        confirmed = 0
        for index, item in enumerate(items):
            try:
                client.registrar_resultado(
                    item["entrega_id"],
                    item["status"],
                    external_id=item.get("external_id"),
                )
                confirmed += 1
            except AutomationApiError as exc:
                remaining.append(item)
                if not exc.retryable:
                    remaining.extend(items[index + 1:])
                    self._save(remaining)
                    raise
        self._save(remaining)
        return confirmed
