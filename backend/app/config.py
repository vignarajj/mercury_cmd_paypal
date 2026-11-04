"""Environment-driven settings with a hard sandbox-only guard."""
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from dotenv import dotenv_values

DEFAULT_ORIGINS_REGEX = r"^(tauri://localhost|https?://tauri\.localhost|http://localhost:\d+|http://127\.0\.0\.1:\d+)$"


DEFAULT_MODEL = "gemma4:e2b-it-qat"  # evaluated 33/33 on the parse corpus (scripts/eval_parser.py)


class ConfigError(RuntimeError):
    """Raised at startup when configuration is missing or unsafe."""


@dataclass(frozen=True)
class Settings:
    paypal_client_id: str
    paypal_client_secret: str
    paypal_api_base: str
    merchant_email: str
    mercury_token: str
    llm_provider: str = "ollama"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = DEFAULT_MODEL
    llm_timeout_s: float = 8.0
    allowed_origins_regex: str = DEFAULT_ORIGINS_REGEX

    def __post_init__(self) -> None:
        host = urlparse(self.paypal_api_base).hostname or ""
        if "sandbox" not in host:
            raise ConfigError(
                f"PAYPAL_API_BASE must be a PayPal sandbox host (got '{host or self.paypal_api_base}'). "
                "Mercury Cmd is sandbox-only."
            )
        if not host.startswith("api"):
            # The dashboard's "Sandbox URL" (https://sandbox.paypal.com) is the website, not the REST API:
            # it serves the token endpoint but answers invoicing calls with a 301 redirect.
            raise ConfigError(
                f"PAYPAL_API_BASE is '{self.paypal_api_base}', which is the sandbox website. "
                "Use the REST API host: https://api-m.sandbox.paypal.com"
            )


def load_settings(env_path: Path | None = None) -> Settings:
    path = env_path or Path(__file__).resolve().parent.parent / ".env"
    values = {**dotenv_values(path), **{k: v for k, v in os.environ.items() if k.startswith(("PAYPAL_", "MERCURY_", "LLM_", "OLLAMA_", "ALLOWED_"))}}

    missing = [k for k in ("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "MERCURY_TOKEN") if not values.get(k)]
    if missing:
        raise ConfigError(f"Missing required settings in {path}: {', '.join(missing)}")

    return Settings(
        paypal_client_id=values["PAYPAL_CLIENT_ID"],
        paypal_client_secret=values["PAYPAL_CLIENT_SECRET"],
        paypal_api_base=(values.get("PAYPAL_API_BASE") or "https://api-m.sandbox.paypal.com").rstrip("/"),
        merchant_email=(values.get("PAYPAL_MERCHANT_EMAIL") or "").strip().lower(),
        mercury_token=values["MERCURY_TOKEN"],
        llm_provider=(values.get("LLM_PROVIDER") or "ollama").lower(),
        ollama_base_url=(values.get("OLLAMA_BASE_URL") or "http://localhost:11434").rstrip("/"),
        ollama_model=values.get("OLLAMA_MODEL") or DEFAULT_MODEL,
        llm_timeout_s=float(values.get("LLM_TIMEOUT_S") or 8),
        allowed_origins_regex=values.get("ALLOWED_ORIGINS_REGEX") or DEFAULT_ORIGINS_REGEX,
    )


@lru_cache
def get_settings() -> Settings:
    return load_settings()
