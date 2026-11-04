"""Server-side checks that make AI output trustworthy.

The model is a suggestion engine, never the source of truth: every email, amount, quantity and
payment term it returns must be backed by the user's own text, otherwise it is dropped with a
visible warning. Completeness is computed here, not taken from the model.
"""
import re
from decimal import Decimal
from typing import Any

from pydantic import EmailStr, TypeAdapter, ValidationError

from ..models import ALLOWED_CURRENCIES, MAX_ITEMS, ParsedInvoice, ParsedItem, to_money
from .regex_parser import detect_currency, extract_terms, first_email

_EMAIL = TypeAdapter(EmailStr)
_NUMBER = re.compile(r"(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s?([kK])?\b")
_TERMS_HINT = re.compile(r"\b(due|net|within|days?|weeks?|months?|receipt)\b", re.I)
_NOTE_HINT = re.compile(r"\b(note|memo|message)\b", re.I)
MAX_AMOUNT = Decimal("1000000")


def numbers_in_text(text: str) -> set[Decimal]:
    """Every number the user typed, as cents-quantized Decimals ('1.5k' also yields 1500.00)."""
    found: set[Decimal] = set()
    for m in _NUMBER.finditer(text):
        try:
            v = Decimal(m.group(1).replace(",", ""))
        except Exception:
            continue
        found.add(to_money(v))
        if m.group(2):
            found.add(to_money(v * 1000))
    return found


def _ground_email(raw: Any, text: str, warnings: list[str]) -> str | None:
    if raw:
        cand = str(raw).strip().strip(".,;:<>()").lower()
        if cand in text.lower():
            try:
                return str(_EMAIL.validate_python(cand)).lower()
            except ValidationError:
                pass
        warnings.append("An email from the AI was not in your text and was ignored.")
    found = first_email(text)  # deterministic extraction is always safe
    if found:
        try:
            return str(_EMAIL.validate_python(found)).lower()
        except ValidationError:
            return None
    return None


def _ground_items(raw_items: Any, text: str, warnings: list[str]) -> list[ParsedItem]:
    nums = numbers_in_text(text)
    items: list[ParsedItem] = []
    for raw in list(raw_items or []):
        if not isinstance(raw, dict):
            continue
        try:
            amount = to_money(raw.get("unit_amount"))
        except ValueError:
            warnings.append("An item had an unreadable amount and was ignored.")
            continue
        if amount <= 0 or amount > MAX_AMOUNT:
            warnings.append(f"Amount {amount} is outside 0 to 1,000,000 and was ignored.")
            continue
        if amount not in nums:
            warnings.append(f"Amount {amount} was not in your text and was ignored.")
            continue
        qty = raw.get("quantity", 1)
        qty = qty if isinstance(qty, int) and not isinstance(qty, bool) and 1 <= qty <= 1000 else 1
        if qty > 1 and Decimal(qty) not in {n.quantize(Decimal("1")) for n in nums}:
            warnings.append("A quantity was not in your text; set to 1.")
            qty = 1
        name = " ".join(str(raw.get("name") or "").split())[:127]
        name = name[:1].upper() + name[1:]
        if not name:
            name = "Services"
            warnings.append("No description found; using 'Services'. Edit it in the preview.")
        items.append(ParsedItem(name=name, quantity=qty, unit_amount=f"{amount:.2f}"))
    if len(items) > MAX_ITEMS:
        warnings.append(f"Only the first {MAX_ITEMS} items are kept.")
        items = items[:MAX_ITEMS]
    return items


def _ground_due_days(raw: Any, text: str) -> int | None:
    from_text, _ = extract_terms(text)
    if from_text is not None:
        return from_text if 0 <= from_text <= 365 else None
    if isinstance(raw, int) and not isinstance(raw, bool) and 0 <= raw <= 365 and _TERMS_HINT.search(text):
        return raw
    return None


def ground(raw: dict, text: str, source: str) -> ParsedInvoice:
    warnings = list(raw.get("_warnings") or [])

    currency = detect_currency(text)
    if currency is None:
        model_cur = str(raw.get("currency") or "").upper()
        currency = model_cur if model_cur in ALLOWED_CURRENCIES else "USD"

    note = raw.get("note")
    note = str(note).strip()[:500] if note and _NOTE_HINT.search(text) else None

    result = ParsedInvoice(
        client_email=_ground_email(raw.get("client_email"), text, warnings),
        items=_ground_items(raw.get("items"), text, warnings),
        currency=currency,
        due_days=_ground_due_days(raw.get("due_days"), text),
        note=note,
        warnings=warnings,
        source=source,
    )
    return result.recompute()
