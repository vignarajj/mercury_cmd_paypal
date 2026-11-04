"""Deterministic fallback parser (single item). Also supplies the text-derived facts
(email, currency, payment terms) that grounding uses to cross-check the LLM."""
import re
from decimal import Decimal

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")

_CUR = r"USD|EUR|GBP|CAD|AUD"
_NUM = r"\d[\d,]*(?:\.\d+)?"
_MARKED = [
    re.compile(rf"(?P<cur>[$€£])\s*(?P<num>{_NUM})\s*(?P<k>[kK]\b)?"),
    re.compile(rf"\b(?P<cur>{_CUR})\s*(?P<num>{_NUM})\s*(?P<k>[kK]\b)?", re.I),
    re.compile(rf"(?<![\w.])(?P<num>{_NUM})\s*(?P<k>[kK])?\s*(?P<cur>\b(?:{_CUR})\b)", re.I),
]
_BARE = re.compile(rf"(?<![\w.])(?P<num>{_NUM})(?P<k>[kK])?\b")

_TERMS = [
    (re.compile(r"\bdue\s+(?:on|upon)\s+receipt\b|\bdue\s+immediately\b", re.I), lambda m: 0),
    (re.compile(r"\bnet\s*-?\s*(\d{1,3})\b", re.I), lambda m: int(m.group(1))),
    (re.compile(r"\bdue\s+(?:in|within)\s+(\d{1,3})\s*(days?|weeks?|months?)\b", re.I),
     lambda m: int(m.group(1)) * {"d": 1, "w": 7, "m": 30}[m.group(2)[0].lower()]),
]

FILLER = {"bill", "invoice", "send", "charge", "create", "make", "generate", "please",
          "to", "for", "of", "a", "an", "the", "about", "regarding"}

_CURRENCY_CODES = {"USD", "EUR", "GBP", "CAD", "AUD"}
_SYMBOLS = {"€": "EUR", "£": "GBP", "$": "USD"}


def first_email(text: str) -> str | None:
    m = EMAIL_RE.search(text)
    return m.group(0) if m else None


def detect_currency(text: str) -> str | None:
    m = re.search(rf"\b({_CUR})\b", text, re.I)
    if m:
        return m.group(1).upper()
    for sym, code in _SYMBOLS.items():
        if sym in text:
            return code
    return None


def extract_terms(text: str) -> tuple[int | None, str]:
    """Return (due_days, text-with-the-terms-phrase-removed)."""
    for pattern, to_days in _TERMS:
        m = pattern.search(text)
        if m:
            return to_days(m), text[: m.start()] + " " + text[m.end():]
    return None, text


def _value(num: str, k: str | None) -> Decimal:
    v = Decimal(num.replace(",", ""))
    return v * 1000 if k else v


def clean_name(s: str) -> str:
    s = re.sub(r"[,:;]+", " ", s)
    tokens = s.split()
    while tokens and tokens[0].lower().strip(".") in FILLER:
        tokens.pop(0)
    while tokens and tokens[-1].lower().strip(".") in FILLER | {"and"}:
        tokens.pop()
    name = " ".join(tokens).strip(" .-–—")
    return name[:1].upper() + name[1:]


def parse_regex(text: str) -> dict:
    """Return a raw extraction in the same shape the LLM produces, plus `_warnings`."""
    warnings: list[str] = []
    email = first_email(text)
    work = text.replace(email, " ", 1) if email else text

    due_days, work = extract_terms(work)

    marked = []
    for pattern in _MARKED:
        for m in pattern.finditer(work):
            marked.append(m)
    marked.sort(key=lambda m: m.start())
    # drop overlaps (e.g. "$450 USD" matched by two patterns)
    spans, last_end = [], -1
    for m in marked:
        if m.start() >= last_end:
            spans.append(m)
            last_end = m.end()

    chosen = None
    if spans:
        chosen = spans[0]
        if len(spans) > 1:
            warnings.append("Several amounts found; basic mode uses the first. Check the preview.")
        for m in reversed(spans):  # strip every priced token so they do not leak into the name
            work = work[: m.start()] + " " + work[m.end():]
        amount = _value(chosen.group("num"), chosen.group("k"))
    else:
        bare = list(_BARE.finditer(work))
        if bare:
            chosen = max(bare, key=lambda m: _value(m.group("num"), m.group("k")))
            if len(bare) > 1:
                warnings.append("Several numbers found; basic mode picked the largest as the amount.")
            work = work[: chosen.start()] + " " + work[chosen.end():]
            amount = _value(chosen.group("num"), chosen.group("k"))

    items = []
    if chosen is not None:
        name = clean_name(work)
        if not name:
            name = "Services"
            warnings.append("No description found; using 'Services'. Edit it in the preview.")
        items.append({"name": name, "quantity": 1, "unit_amount": f"{amount:.2f}"})

    return {
        "client_email": email,
        "items": items,
        "currency": detect_currency(text),
        "due_days": due_days,
        "note": None,
        "_warnings": warnings,
    }
