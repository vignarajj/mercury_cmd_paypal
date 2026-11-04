"""Small user preferences file (the chosen AI model and whether cloud models are allowed), kept next to the backend and git-ignored."""
import json
import logging
import os
from pathlib import Path

log = logging.getLogger("mercury.prefs")

DEFAULT_PATH = Path(__file__).resolve().parent.parent.parent / ".mercury-prefs.json"


class Preferences:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or Path(os.environ.get("MERCURY_PREFS_PATH") or DEFAULT_PATH)

    def _read(self) -> dict:
        try:
            data = json.loads(self.path.read_text())
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    @property
    def ollama_model(self) -> str | None:
        value = self._read().get("ollama_model")
        return value.strip() if isinstance(value, str) and value.strip() else None

    @property
    def allow_cloud(self) -> bool:
        return self._read().get("allow_cloud") is True

    def set_ollama_model(self, model: str) -> None:
        self._write("ollama_model", model)

    def set_allow_cloud(self, allow: bool) -> None:
        self._write("allow_cloud", allow)

    def _write(self, key: str, value: object) -> None:
        data = self._read()
        data[key] = value
        try:
            self.path.write_text(json.dumps(data, indent=2) + "\n")
        except OSError as exc:  # still works for this session; just not remembered
            log.warning("Could not save preferences to %s: %s", self.path, exc)
