from __future__ import annotations

import os
import re
import socket
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(_path):
        return False

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "sim", "s"}


def _int_env(*names: str, default: int) -> int:
    for name in names:
        value = os.getenv(name)
        if value not in (None, ""):
            try:
                return int(value)
            except ValueError:
                return default
    return default


def _str_env(*names: str, default: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value not in (None, ""):
            return value
    return default


def _is_unsafe_chrome_profile(path: Path) -> bool:
    normalized = str(path.expanduser())
    unsafe_parts = (
        ".config/google-chrome",
        ".config/chromium",
        ".config/BraveSoftware/Brave-Browser",
    )
    return any(part in normalized for part in unsafe_parts)


@dataclass(frozen=True)
class Settings:
    api_base_url: str = os.getenv("API_BASE_URL", "http://127.0.0.1:3001").rstrip("/")
    automation_api_token: str = os.getenv("AUTOMATION_API_TOKEN", "")
    api_timeout_seconds: int = _int_env("API_TIMEOUT_SECONDS", default=20)
    api_retry_delay_seconds: int = _int_env("API_RETRY_DELAY_SECONDS", default=15)
    allow_insecure_http: bool = _bool_env("ALLOW_INSECURE_HTTP", False)
    worker_id: str = _str_env(
        "AUTOMATION_WORKER_ID",
        default=re.sub(r"[^a-zA-Z0-9._:-]", "-", socket.gethostname())[:60] or "worker-local",
    )

    browser: str = os.getenv("BROWSER", "chrome").strip().lower()
    headless: bool = _bool_env("HEADLESS", False)
    raw_user_data_dir: str = _str_env(
        "USER_DATA_DIR",
        "BROWSER_PROFILE_PATH",
        default="./runtime/whatsapp-profile",
    )
    action_min_delay_seconds: float = float(
        _str_env("ACTION_MIN_DELAY_SECONDS", "ACTION_MIN_DELAY", default="0.8")
    )
    action_max_delay_seconds: float = float(
        _str_env("ACTION_MAX_DELAY_SECONDS", "ACTION_MAX_DELAY", default="2.0")
    )
    send_min_delay_seconds: float = float(
        _str_env(
            "SEND_MIN_DELAY_SECONDS",
            "SEND_MIN_DELAY",
            "MIN_DELAY_SECONDS",
            "MIN_DELAY",
            default="5",
        )
    )
    send_max_delay_seconds: float = float(
        _str_env(
            "SEND_MAX_DELAY_SECONDS",
            "SEND_MAX_DELAY",
            "MAX_DELAY_SECONDS",
            "MAX_DELAY",
            default="12",
        )
    )
    dry_run: bool = _bool_env("DRY_RUN", _bool_env("TEST_MODE", False))
    wait_login_seconds: int = _int_env("WAIT_LOGIN_SECONDS", default=180)
    page_load_timeout_seconds: int = _int_env("PAGE_LOAD_TIMEOUT_SECONDS", default=20)
    conversation_wait_seconds: int = _int_env("CONVERSATION_WAIT_SECONDS", default=35)
    after_send_wait_seconds: float = float(
        _str_env("AFTER_SEND_WAIT_SECONDS", default="1.5")
    )
    numero_maquina: int = _int_env("NUMERO_MAQUINA", default=1)
    poll_interval_seconds: int = _int_env("POLL_INTERVAL_SECONDS", default=20)
    run_once: bool = _bool_env("RUN_ONCE", False)

    @property
    def resolved_user_data_dir(self) -> Path:
        configured = Path(self.raw_user_data_dir).expanduser()
        if not configured.is_absolute():
            configured = BASE_DIR / configured
        if _is_unsafe_chrome_profile(configured):
            return BASE_DIR / "runtime" / "whatsapp-profile"
        return configured

    def validate(self) -> None:
        parsed = urlparse(self.api_base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise RuntimeError("API_BASE_URL inválida. Informe a URL completa do backend.")
        host_local = (parsed.hostname or "").lower() in {"127.0.0.1", "localhost", "::1"}
        if parsed.scheme != "https" and not host_local and not self.allow_insecure_http:
            raise RuntimeError(
                "API_BASE_URL remota deve usar HTTPS. Use ALLOW_INSECURE_HTTP=true apenas em rede local controlada."
            )
        if len(self.automation_api_token) < 32:
            raise RuntimeError(
                "AUTOMATION_API_TOKEN ausente ou fraco. Configure a credencial das máquinas autorizadas."
            )
        if self.numero_maquina not in {1, 2, 3, 4, 5}:
            raise RuntimeError("NUMERO_MAQUINA deve estar entre 1 e 5.")
        if not re.fullmatch(r"[a-zA-Z0-9._:-]{3,80}", self.worker_id):
            raise RuntimeError("AUTOMATION_WORKER_ID possui formato inválido.")
        if not 3 <= self.api_timeout_seconds <= 120:
            raise RuntimeError("API_TIMEOUT_SECONDS deve ficar entre 3 e 120 segundos.")
        if not 5 <= self.poll_interval_seconds <= 300:
            raise RuntimeError("POLL_INTERVAL_SECONDS deve ficar entre 5 e 300 segundos.")


settings = Settings()
