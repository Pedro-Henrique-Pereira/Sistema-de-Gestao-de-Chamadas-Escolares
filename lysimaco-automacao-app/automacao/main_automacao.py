# só Deus sabe o quanto eu sofri pra chegar nesse código aqui, me julguem não
from __future__ import annotations

import logging
from typing import Callable, Any
from logging.handlers import RotatingFileHandler
import sys
import time
from pathlib import Path

from selenium.common.exceptions import SessionNotCreatedException, TimeoutException, WebDriverException, InvalidSessionIdException, NoSuchWindowException

from automacao.config.settings import BASE_DIR, settings
from automacao.services.api_service import (
    AutomationApiClient,
    AutomationApiError,
    ReceiptJournal,
    TarefaAutomacao,
    codigo_erro_seguro,
    mascarar_telefone,
)
from automacao.services.whatsapp_service import WhatsAppService
from automacao.support.error_ui import mostrar_erro_critico, mostrar_erro_simples

LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

file_handler = RotatingFileHandler(
    LOG_DIR / "envios.log",
    maxBytes=5 * 1024 * 1024,
    backupCount=3,
    encoding="utf-8",
)
file_handler.setFormatter(formatter)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(formatter)

root_logger.handlers.clear()
root_logger.addHandler(file_handler)
root_logger.addHandler(console_handler)

logger = logging.getLogger(__name__)

GUI_MODE = False

ERROS_SIMPLES = (
    TimeoutException,
    WebDriverException,
    SessionNotCreatedException,
    InvalidSessionIdException,
    NoSuchWindowException,
    ConnectionError,
    OSError,
)

ERROS_GRAVES = (
    SyntaxError,
    AttributeError,
    NameError,
    ImportError,
    ModuleNotFoundError,
)


def classificar_erro(exc: BaseException) -> str:
    """Classifica a falha"""
    if isinstance(exc, ERROS_GRAVES):
        return "grave"

    if isinstance(exc, ERROS_SIMPLES):
        return "simples"

    texto = f"{type(exc).__name__}: {exc}".lower()
    sinais_graves = ["syntax", "import", "module", "attributeerror", "nameerror"]
    if any(sinal in texto for sinal in sinais_graves):
        return "grave"

    sinais_simples = ["timeout", "timed out", "internet", "network", "chrome", "firefox", "webdriver", "connection"]
    if any(sinal in texto for sinal in sinais_simples):
        return "simples"

    return "grave"


def tratar_falha_global(exc: BaseException, solicitacao_id: int | None = None) -> None:
    tipo = classificar_erro(exc)
    codigo = codigo_erro_seguro(exc)
    logger.error("Falha na automação classificada como %s. code=%s", tipo, codigo)

    if GUI_MODE:
        logger.info("Erro registrado no painel da interface. Pop-up/console antigo suprimido no modo GUI.")
        return

    if tipo == "simples":
        mostrar_erro_simples(RuntimeError(codigo))
    else:
        mostrar_erro_critico(RuntimeError(codigo))


def processar_solicitacao(
    solicitacao: TarefaAutomacao,
    api_client: AutomationApiClient,
    receipt_journal: ReceiptJournal,
    whatsapp: WhatsAppService | None = None,
    activity_callback: Callable[[str], None] | None = None,
) -> bool:
    """Processa apenas as entregas reservadas pela API e confirma cada checkpoint."""
    solicitacao_id = solicitacao.id
    logger.info(
        "Processando tarefa técnica #%s (%s), entregas=%s.",
        solicitacao_id,
        solicitacao.tipo,
        len(solicitacao.entregas),
    )
    if activity_callback is not None:
        try:
            activity_callback(f"Processando tarefa #{solicitacao_id}")
        except Exception:
            pass
    whatsapp_local = whatsapp
    fechar_ao_final = False

    try:
        if not solicitacao.entregas:
            logger.info(
                "Tarefa #%s sem entregas reservadas; status da API=%s.",
                solicitacao_id,
                solicitacao.status,
            )
            return True

        if whatsapp_local is None:
            whatsapp_local = WhatsAppService()
            fechar_ao_final = True
            if not settings.dry_run:
                whatsapp_local.abrir_whatsapp()

        enviados = 0
        falhas = 0
        for indice, entrega in enumerate(solicitacao.entregas, start=1):
            try:
                api_client.heartbeat(
                    "online_busy",
                    current_task_id=solicitacao_id,
                )
                destino_log = (
                    f"grupo técnico #{entrega.id}"
                    if entrega.canal == "grupo"
                    else mascarar_telefone(entrega.telefone)
                )
                logger.info(
                    "[%s/%s] Entrega #%s, canal=%s, destino=%s, tentativa=%s.",
                    indice, len(solicitacao.entregas), entrega.id, entrega.canal,
                    destino_log, entrega.tentativa,
                )
                if activity_callback is not None:
                    try:
                        activity_callback(f"Enviando entrega #{entrega.id}")
                    except Exception:
                        pass

                if settings.dry_run:
                    logger.info("[DRY_RUN] Entrega #%s ignorada sem expor conteúdo.", entrega.id)
                    receipt_journal.record(entrega.id, "ignorado")
                elif entrega.canal == "grupo":
                    whatsapp_local.enviar_mensagem_grupo(
                        entrega.nome_grupo or "",
                        entrega.mensagem,
                        nome_grupo_busca=entrega.nome_grupo_busca,
                    )
                    receipt_journal.record(entrega.id, "enviado")
                else:
                    whatsapp_local.enviar_mensagem(entrega.telefone or "", entrega.mensagem)
                    receipt_journal.record(entrega.id, "enviado")

                confirmados = receipt_journal.flush(api_client)
                if confirmados < 1:
                    raise AutomationApiError(
                        "Envio concluído localmente, mas o checkpoint aguarda confirmação da API.",
                        retryable=True,
                    )
                enviados += 1
                logger.info("Entrega #%s confirmada pela API.", entrega.id)
            except AutomationApiError:
                raise
            except Exception as exc_envio:
                falhas += 1
                logger.warning(
                    "Falha resumida na entrega #%s; code=%s. A API controlará a retentativa.",
                    entrega.id,
                    codigo_erro_seguro(exc_envio),
                )
                try:
                    api_client.registrar_resultado(
                        entrega.id,
                        "erro",
                        codigo_erro_seguro(exc_envio),
                    )
                except AutomationApiError:
                    logger.warning(
                        "Não foi possível registrar a falha da entrega #%s na API.",
                        entrega.id,
                    )

            if indice < len(solicitacao.entregas):
                whatsapp_local.delay_entre_envios()

        logger.info(
            "Fim da tarefa #%s: enviadas=%s, falhas=%s.",
            solicitacao_id,
            enviados,
            falhas,
        )
        return falhas == 0

    except Exception as exc:
        tratar_falha_global(exc, solicitacao_id)
        return False
    finally:
        if fechar_ao_final and whatsapp_local is not None:
            whatsapp_local.fechar()


class GuiLogHandler(logging.Handler):
    """Espelha logs do robô no console da interface sem acoplar Selenium à GUI."""

    def __init__(self, log_callback: Callable[[str], None]) -> None:
        super().__init__(level=logging.INFO)
        self.log_callback = log_callback
        self.setFormatter(logging.Formatter("%(levelname)s | %(message)s"))

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.log_callback(self.format(record))
        except Exception:
            # Nunca deixa falha visual derrubar a automação.
            pass


class GuiStreamRedirector:
    """Copia prints/stdout/stderr para terminal e para o console da GUI em tempo real."""

    def __init__(self, original_stream, log_callback: Callable[[str], None], prefix: str = "") -> None:
        self.original_stream = original_stream
        self.log_callback = log_callback
        self.prefix = prefix
        self._buffer = ""

    def write(self, text: str) -> int:
        if not text:
            return 0

        try:
            self.original_stream.write(text)
            self.original_stream.flush()
        except Exception:
            pass

        self._buffer += text
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            line = line.rstrip()
            if line:
                try:
                    self.log_callback(f"{self.prefix}{line}")
                except Exception:
                    pass
        return len(text)

    def flush(self) -> None:
        try:
            self.original_stream.flush()
        except Exception:
            pass
        if self._buffer.strip():
            try:
                self.log_callback(f"{self.prefix}{self._buffer.strip()}")
            except Exception:
                pass
            self._buffer = ""

    def isatty(self) -> bool:
        try:
            return self.original_stream.isatty()
        except Exception:
            return False


def aplicar_configuracao_runtime(runtime_config: dict[str, Any] | None) -> None:
    """Aplica parâmetros vindos da interface ao objeto settings já usado pela automação.

    Não altera SQL, tabelas, queries nem a lógica de captura concorrente. Apenas atualiza
    valores de execução em memória para esta instância do robô.
    """
    if not runtime_config:
        return

    delays = runtime_config.get("delays") or {}
    whatsapp_cfg = runtime_config.get("whatsapp") or {}

    def get_float(name: str, default: float) -> float:
        try:
            return float(str(delays.get(name, default)).replace(",", "."))
        except (TypeError, ValueError):
            return default

    maquina = int(runtime_config.get("maquina_id", settings.numero_maquina))
    intervalo = int(runtime_config.get("intervalo_verificacao", settings.poll_interval_seconds))
    pausa_inicial = get_float("pausa_inicial", 0.0)
    pausa_entre = get_float("pausa_entre_envios", settings.send_min_delay_seconds)
    pausa_pos = get_float("pausa_pos_envio", settings.after_send_wait_seconds)

    def get_int_config(source: dict[str, Any], name: str, default: int, minimum: int, maximum: int) -> int:
        try:
            value = int(float(str(source.get(name, default)).replace(",", ".")))
        except (TypeError, ValueError):
            value = default
        return max(minimum, min(maximum, value))

    tempo_espera_conversa = get_int_config(
        whatsapp_cfg,
        "tempo_espera_conversa",
        int(getattr(settings, "conversation_wait_seconds", 35)),
        35,
        180,
    )

    object.__setattr__(settings, "numero_maquina", maquina)
    object.__setattr__(settings, "poll_interval_seconds", intervalo)

    # A pausa inicial da GUI é usada apenas no carregamento/sessão do WhatsApp.
    # As ações internas do Selenium ficam curtas e técnicas para evitar lentidão acumulada.
    object.__setattr__(settings, "initial_load_delay_seconds", max(0.0, pausa_inicial))
    object.__setattr__(settings, "action_min_delay_seconds", 0.05)
    object.__setattr__(settings, "action_max_delay_seconds", 0.15)

    # A pausa entre envios passa a ser aplicada estritamente entre um destino e outro.
    object.__setattr__(settings, "send_min_delay_seconds", max(0.0, pausa_entre))
    object.__setattr__(settings, "send_max_delay_seconds", max(0.0, pausa_entre))
    object.__setattr__(settings, "after_send_wait_seconds", max(0.0, pausa_pos))
    object.__setattr__(settings, "conversation_wait_seconds", tempo_espera_conversa)
    object.__setattr__(settings, "group_search_wait_seconds", 0.8)
    object.__setattr__(settings, "quick_send_button_wait_seconds", 1.5)


def instalar_handler_gui(log_callback: Callable[[str], None] | None):
    if log_callback is None:
        return None

    handler = GuiLogHandler(log_callback)
    root_logger.addHandler(handler)

    stdout_original = sys.stdout
    stderr_original = sys.stderr
    sys.stdout = GuiStreamRedirector(stdout_original, log_callback)
    sys.stderr = GuiStreamRedirector(stderr_original, log_callback, prefix="[STDERR] ")

    return {
        "handler": handler,
        "stdout": stdout_original,
        "stderr": stderr_original,
    }


def remover_handler_gui(gui_context) -> None:
    if gui_context is None:
        return
    try:
        handler = gui_context.get("handler") if isinstance(gui_context, dict) else gui_context
        if handler is not None:
            root_logger.removeHandler(handler)
            handler.close()
    except Exception:
        pass

    if isinstance(gui_context, dict):
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        try:
            sys.stdout = gui_context.get("stdout", sys.stdout)
            sys.stderr = gui_context.get("stderr", sys.stderr)
        except Exception:
            pass


def aguardar_com_parada(segundos: float, stop_event=None) -> bool:
    """Retorna True se uma parada foi solicitada durante a espera."""
    segundos = max(0.0, float(segundos))
    if stop_event is None:
        time.sleep(segundos)
        return False
    return bool(stop_event.wait(segundos))


def main(runtime_config: dict[str, Any] | None = None, stop_event=None, log_callback: Callable[[str], None] | None = None, activity_callback: Callable[[str], None] | None = None) -> int:
    global GUI_MODE
    GUI_MODE = log_callback is not None
    gui_handler = instalar_handler_gui(log_callback)
    aplicar_configuracao_runtime(runtime_config)

    logger.info("Iniciando RPA WhatsApp - aguardando fila de automação")
    logger.info("Navegador configurado: %s", settings.browser)

    if settings.numero_maquina not in {1, 2, 3, 4, 5}:
        logger.error("NUMERO_MAQUINA inválido. Configure no .env ou na interface um valor entre 1 e 5.")
        remover_handler_gui(gui_handler)
        GUI_MODE = False
        return 1

    logger.info(
        "Máquina local configurada como NUMERO_MAQUINA=%s. Polling a cada %ss.",
        settings.numero_maquina,
        settings.poll_interval_seconds,
    )
    logger.info(
        "Delays ativos: pausa inicial=%ss | ação técnica=%s-%ss | entre envios=%ss | pós-envio=%ss.",
        getattr(settings, "initial_load_delay_seconds", 0),
        settings.action_min_delay_seconds,
        settings.action_max_delay_seconds,
        settings.send_min_delay_seconds,
        settings.after_send_wait_seconds,
    )
    logger.info(
        "WhatsApp: espera da conversa=%ss | retentativas controladas pela API.",
        getattr(settings, "conversation_wait_seconds", 35),
    )

    try:
        settings.validate()
    except Exception as exc:
        tratar_falha_global(exc)
        remover_handler_gui(gui_handler)
        return 1

    api_client = AutomationApiClient(machine_id=settings.numero_maquina)
    receipt_journal = ReceiptJournal()
    try:
        health = api_client.health()
        maquina_autenticada = int(health.get("maquina_id") or 0)
        if maquina_autenticada != settings.numero_maquina:
            raise RuntimeError(
                "A credencial não autorizou a máquina selecionada na interface."
            )
        logger.info(
            "API da automação autenticada para a máquina %s.",
            maquina_autenticada,
        )
        heartbeat = api_client.heartbeat("online_available")
        logger.info(
            "Heartbeat registrado. estado=%s fila=%s versão=%s.",
            heartbeat.get("machine", {}).get("state", "online_available"),
            heartbeat.get("machine", {}).get("queueDepth", 0),
            settings.app_version,
        )
    except AutomationApiError as exc:
        if not exc.retryable:
            tratar_falha_global(exc)
            remover_handler_gui(gui_handler)
            return 1
        logger.warning("API temporariamente indisponível na inicialização; o polling continuará com backoff.")
    except Exception as exc:
        tratar_falha_global(exc)
        remover_handler_gui(gui_handler)
        return 1

    whatsapp: WhatsAppService | None = None

    try:
        while True:
            if stop_event is not None and stop_event.is_set():
                logger.info("Parada solicitada. Encerrando busca por novas tarefas.")
                return 0

            try:
                confirmados_pendentes = receipt_journal.flush(api_client)
                if confirmados_pendentes:
                    logger.info(
                        "Checkpoints locais sincronizados após reinicialização: %s.",
                        confirmados_pendentes,
                    )
                if receipt_journal.pending_count() > 0:
                    logger.warning(
                        "Há checkpoints de envio aguardando a API; novas tarefas não serão capturadas para evitar duplicidade."
                    )
                    if aguardar_com_parada(settings.api_retry_delay_seconds, stop_event):
                        return 0
                    continue

                solicitacao = api_client.capturar_tarefa()
                if solicitacao:
                    logger.info("Tarefa #%s capturada para a máquina %s.", solicitacao.id, settings.numero_maquina)
                    api_client.heartbeat(
                        "online_busy",
                        current_task_id=solicitacao.id,
                    )
                    if activity_callback is not None:
                        try:
                            activity_callback(f"Tarefa capturada #{solicitacao.id}")
                        except Exception:
                            pass
                    if (
                        solicitacao.entregas
                        and not settings.dry_run
                        and (whatsapp is None or not whatsapp.driver_esta_vivo())
                    ):
                        if whatsapp is not None:
                            logger.warning("Driver Selenium inválido antes de processar tarefa. Recriando sessão limpa.")
                            try:
                                whatsapp.fechar()
                            except Exception:
                                pass
                        whatsapp = WhatsAppService()
                        whatsapp.abrir_whatsapp()
                        pausa_inicial = float(getattr(settings, "initial_load_delay_seconds", 0) or 0)
                        if pausa_inicial > 0:
                            logger.info("Pausa inicial configurada registrada: %ss. WhatsApp já validado; aplicando espera técnica máxima de 1s.", pausa_inicial)
                            aguardar_com_parada(min(pausa_inicial, 1), stop_event)

                    while solicitacao:
                        tipo_solicitacao_atual = solicitacao.tipo
                        tarefa_sem_falhas = processar_solicitacao(
                            solicitacao,
                            api_client,
                            receipt_journal,
                            whatsapp,
                            activity_callback=activity_callback,
                        )
                        if not tarefa_sem_falhas:
                            logger.info("Falha parcial registrada; a próxima tentativa aguardará o polling configurado.")
                            break
                        if not solicitacao.entregas and solicitacao.status == "executando":
                            logger.info("Tarefa ainda possui entrega em processamento; aguardando próximo polling.")
                            break
                        if settings.run_once:
                            break
                        if stop_event is not None and stop_event.is_set():
                            logger.info("Parada solicitada após concluir a tarefa atual. Nenhuma nova tarefa será capturada.")
                            break

                        if receipt_journal.pending_count() > 0:
                            logger.warning("Checkpoint pendente detectado; captura pausada.")
                            break

                        solicitacao = api_client.capturar_tarefa()
                        if solicitacao and activity_callback is not None:
                            try:
                                activity_callback(f"Tarefa capturada #{solicitacao.id}")
                            except Exception:
                                pass

                        # Para grupos, espera somente quando realmente existe outra tarefa em seguida.
                        # Isso remove a pausa desperdiçada depois do último envio.
                        if (
                            solicitacao
                            and tipo_solicitacao_atual == "mensagem_grupo"
                            and solicitacao.tipo == "mensagem_grupo"
                            and whatsapp is not None
                        ):
                            whatsapp.delay_entre_envios()

                    # Mantém o navegador aberto enquanto a automação estiver ligada.
                    # Ele só será fechado no desligamento ou em caso de erro crítico.
                else:
                    logger.info("Nenhuma tarefa elegível na API. Aguardando...")
                    api_client.heartbeat("online_available")

                if settings.run_once:
                    return 0

                if aguardar_com_parada(settings.poll_interval_seconds, stop_event):
                    logger.info("Parada solicitada durante o intervalo de verificação.")
                    return 0

            except KeyboardInterrupt:
                logger.info("Encerrado pelo usuário.")
                return 0
            except AutomationApiError as exc:
                logger.warning(
                    "Falha de API status=%s retryable=%s.",
                    exc.status or "conexao",
                    exc.retryable,
                )
                if not exc.retryable:
                    try:
                        api_client.heartbeat(
                            "online_error",
                            last_error_code=codigo_erro_seguro(exc),
                        )
                    except Exception:
                        pass
                    tratar_falha_global(exc)
                    return 1
                if aguardar_com_parada(settings.api_retry_delay_seconds, stop_event):
                    return 0
            except Exception as exc:
                tratar_falha_global(exc)
                try:
                    api_client.heartbeat(
                        "online_error",
                        last_error_code=codigo_erro_seguro(exc),
                    )
                except Exception:
                    pass
                if whatsapp is not None:
                    logger.info("Fechando navegador Selenium após erro.")
                    whatsapp.fechar()
                    whatsapp = None
                if settings.run_once:
                    return 1
                if aguardar_com_parada(settings.poll_interval_seconds, stop_event):
                    logger.info("Parada solicitada durante espera após erro.")
                    return 0
    finally:
        if whatsapp is not None:
            logger.info("Encerrando navegador Selenium com driver.quit().")
            whatsapp.fechar()
        remover_handler_gui(gui_handler)
        GUI_MODE = False


def run_from_gui(
    runtime_config: dict[str, Any],
    stop_event,
    log_callback: Callable[[str], None],
    activity_callback: Callable[[str], None] | None = None,
) -> int:
    """Ponto de entrada usado pela interface CustomTkinter."""
    return main(
        runtime_config=runtime_config,
        stop_event=stop_event,
        log_callback=log_callback,
        activity_callback=activity_callback,
    )


if __name__ == "__main__":
    raise SystemExit(main())
# se eu ja fui feliz não lembro mais
