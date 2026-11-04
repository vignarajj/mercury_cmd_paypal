"""Ollama structured-output client and the parse orchestrator (LLM first, regex fallback)."""
import asyncio
import json
import logging

import httpx

from ..config import Settings
from ..models import ParsedInvoice
from .grounding import ground
from .regex_parser import parse_regex

log = logging.getLogger("mercury.ai")

SYSTEM_PROMPT = """You extract invoice details from one short message. Reply with JSON only, matching the schema.
Rules:
- client_email: copy the email address exactly as written, or null if none appears.
- items: one entry per deliverable. name is a short description (no price, no email). unit_amount is the price of ONE unit as a plain number string such as "1200.00", copied from the text. Never calculate or guess prices. quantity defaults to 1.
- currency: USD, EUR, GBP, CAD or AUD when stated or implied by a symbol, otherwise null.
- due_days: payment terms as a number of days ("net 30" is 30, "due on receipt" is 0), otherwise null.
- note: only when the user explicitly asks for a note, otherwise null.
- Never invent values. Use null, or an empty items list, when something is missing."""

FEW_SHOT = [
    ("Invoice dana@studio.io $800 for illustrations and $150 for revisions, due on receipt",
     {"client_email": "dana@studio.io", "currency": "USD", "due_days": 0, "note": None,
      "items": [{"name": "Illustrations", "quantity": 1, "unit_amount": "800.00"},
                {"name": "Revisions", "quantity": 1, "unit_amount": "150.00"}]}),
    ("charge 200 for hosting",
     {"client_email": None, "currency": None, "due_days": None, "note": None,
      "items": [{"name": "Hosting", "quantity": 1, "unit_amount": "200.00"}]}),
]


# Hand-written, flat, fully-required schema. A pydantic-generated one (with $defs/$ref and optional
# fields) made small local models silently omit `items` altogether; verified against a live model.
LLM_SCHEMA = {
    "type": "object",
    "properties": {
        "client_email": {"type": ["string", "null"]},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "quantity": {"type": "integer"},
                    "unit_amount": {"type": "string"},
                },
                "required": ["name", "quantity", "unit_amount"],
            },
        },
        "currency": {"type": ["string", "null"]},
        "due_days": {"type": ["integer", "null"]},
        "note": {"type": ["string", "null"]},
    },
    "required": ["client_email", "items", "currency", "due_days", "note"],
}


class LLMUnavailable(Exception):
    """The model could not produce a usable answer in time; the caller falls back to regex."""


class OllamaClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self._s = settings
        self._http = http
        self._schema = LLM_SCHEMA
        self.model = settings.ollama_model  # can be changed at runtime from Settings

    def _messages(self, text: str) -> list[dict]:
        msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
        for user, out in FEW_SHOT:
            msgs += [{"role": "user", "content": user}, {"role": "assistant", "content": json.dumps(out)}]
        return msgs + [{"role": "user", "content": text}]

    async def extract(self, text: str) -> dict:
        payload = {
            "model": self.model,
            "messages": self._messages(text),
            "stream": False,
            "format": self._schema,
            "keep_alive": "30m",
            "options": {"temperature": 0},
        }
        try:
            resp = await asyncio.wait_for(
                self._http.post(f"{self._s.ollama_base_url}/api/chat", json=payload, timeout=None),
                timeout=self._s.llm_timeout_s,
            )
        except (TimeoutError, httpx.HTTPError) as exc:
            raise LLMUnavailable(f"Ollama unreachable or too slow: {type(exc).__name__}") from exc
        if resp.status_code != 200:
            raise LLMUnavailable(f"Ollama returned HTTP {resp.status_code}")
        try:
            data = json.loads(resp.json()["message"]["content"])
        except (KeyError, TypeError, ValueError) as exc:
            raise LLMUnavailable("Ollama returned invalid JSON") from exc
        if not isinstance(data, dict):
            raise LLMUnavailable("Ollama returned a non-object")
        return data

    async def warm_up(self) -> bool:
        """Load the model into memory so the first real parse is fast. Never raises."""
        try:
            resp = await self._http.post(
                f"{self._s.ollama_base_url}/api/chat",
                json={"model": self.model, "messages": [{"role": "user", "content": "ping"}],
                      "stream": False, "keep_alive": "30m", "options": {"num_predict": 1}},
                timeout=90,
            )
            return resp.status_code == 200
        except (httpx.HTTPError, TimeoutError):
            return False

    async def installed_models(self) -> list[dict] | None:
        """Local chat models installed in Ollama, or None when Ollama cannot be reached.

        Cloud models (they run on ollama.com, so the text would leave this computer) and embedding-only
        models are left out.
        """
        try:
            resp = await self._http.get(f"{self._s.ollama_base_url}/api/tags", timeout=2)
            raw = resp.json().get("models", [])
        except (httpx.HTTPError, ValueError, TimeoutError):
            return None
        out = []
        for m in raw:
            name = m.get("name", "")
            caps = m.get("capabilities")
            if not name or m.get("remote_host") or name.endswith(":cloud"):
                continue
            if caps is not None and "completion" not in caps:
                continue
            if caps is None and "embed" in name:
                continue
            details = m.get("details") or {}
            out.append({"name": name, "size_bytes": m.get("size"), "parameters": details.get("parameter_size") or None})
        return sorted(out, key=lambda m: m["name"])

    async def health(self) -> str:
        """'ok' | 'model_missing' | 'offline'"""
        try:
            resp = await self._http.get(f"{self._s.ollama_base_url}/api/tags", timeout=2)
            names = [m.get("name", "") for m in resp.json().get("models", [])]
        except (httpx.HTTPError, ValueError, TimeoutError):
            return "offline"
        want = self.model
        return "ok" if any(n == want or n.split(":")[0] == want.split(":")[0] and ":" not in want for n in names) else "model_missing"


class ParseService:
    def __init__(self, llm: OllamaClient | None) -> None:
        self._llm = llm

    async def parse(self, text: str) -> ParsedInvoice:
        text = text.strip()
        regex_result = ground(parse_regex(text), text, "regex")

        if self._llm is not None:
            try:
                result = ground(await self._llm.extract(text), text, "llm")
            except LLMUnavailable as exc:
                log.warning("LLM unavailable, using regex fallback: %s", exc)
            else:
                if not result.items and regex_result.items:
                    result.items = regex_result.items
                    result.source = "regex"  # the items did not come from the model; label it honestly
                    result.warnings.append("The AI found no items; filled in by the basic parser. Check the preview.")
                    result.recompute()
                return result

        regex_result.warnings.append("Basic mode: single item only.")
        return regex_result
