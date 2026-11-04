"""Request/response models. Money is always Decimal, serialized as a 2-decimal string."""
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Annotated

from pydantic import BaseModel, EmailStr, Field, field_serializer, field_validator

ALLOWED_CURRENCIES = ("USD", "EUR", "GBP", "CAD", "AUD")
MAX_ITEMS = 10
CENT = Decimal("0.01")


def to_money(value: object) -> Decimal:
    """Parse a number or numeric string into a Decimal quantized to cents."""
    if isinstance(value, float):
        value = str(value)
    if isinstance(value, str):
        value = value.replace(",", "").replace("$", "").strip()
    try:
        return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)  # type: ignore[arg-type]
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("amount must be a number") from exc


class LineItem(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=127)]
    quantity: Annotated[int, Field(ge=1, le=1000)] = 1
    unit_amount: Decimal

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v

    @field_validator("unit_amount", mode="before")
    @classmethod
    def _money(cls, v: object) -> Decimal:
        d = to_money(v)
        if d <= 0 or d > Decimal("1000000"):
            raise ValueError("amount must be greater than 0 and at most 1,000,000")
        return d

    @field_serializer("unit_amount")
    def _ser_amount(self, v: Decimal) -> str:
        return f"{v:.2f}"


class InvoiceRequest(BaseModel):
    client_email: EmailStr
    items: Annotated[list[LineItem], Field(min_length=1, max_length=MAX_ITEMS)]
    currency: str = "USD"
    due_days: Annotated[int, Field(ge=0, le=365)] | None = None
    note: Annotated[str, Field(max_length=500)] | None = None
    request_id: Annotated[str, Field(min_length=8, max_length=64)]

    @field_validator("currency")
    @classmethod
    def _currency(cls, v: str) -> str:
        v = v.upper().strip()
        if v not in ALLOWED_CURRENCIES:
            raise ValueError(f"currency must be one of {', '.join(ALLOWED_CURRENCIES)}")
        return v

    @property
    def total(self) -> Decimal:
        return sum((i.unit_amount * i.quantity for i in self.items), Decimal("0.00")).quantize(CENT)


class InvoiceResult(BaseModel):
    invoice_id: str
    invoice_url: str
    status: str
    client_email: str
    total: str
    currency: str


class InvoiceStatus(BaseModel):
    invoice_id: str
    status: str
    paid_at: str | None = None


# ------------------------------------------------------------------ parsing

class ModelChoice(BaseModel):
    model: Annotated[str, Field(min_length=1, max_length=200)]


class CloudChoice(BaseModel):
    allow: bool


class ParseRequest(BaseModel):
    text: Annotated[str, Field(min_length=1, max_length=1000)]

    @field_validator("text")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("text must not be blank")
        return v


class ParsedItem(BaseModel):
    name: str
    quantity: int = 1
    unit_amount: str  # 2-decimal string, e.g. "1200.00"


class ParsedInvoice(BaseModel):
    client_email: str | None = None
    items: list[ParsedItem] = []
    currency: str = "USD"
    due_days: int | None = None
    note: str | None = None
    missing_fields: list[str] = []
    is_complete: bool = False
    warnings: list[str] = []
    source: str = "regex"  # "llm" | "regex"

    def recompute(self) -> "ParsedInvoice":
        """Server-side truth for completeness; the model's own flags are never trusted."""
        self.missing_fields = [f for f, ok in (("client_email", self.client_email), ("items", self.items)) if not ok]
        self.is_complete = not self.missing_fields
        return self


# ---------------------------------------------------------- history and detail

LIST_STATUSES = (
    "DRAFT", "SENT", "SCHEDULED", "PAID", "MARKED_AS_PAID", "CANCELLED", "REFUNDED",
    "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "MARKED_AS_REFUNDED", "UNPAID", "PAYMENT_PENDING",
)


class InvoiceSummary(BaseModel):
    invoice_id: str
    number: str | None = None
    status: str
    client_email: str
    total: str
    currency: str
    created_at: str | None = None
    invoice_url: str


class InvoiceList(BaseModel):
    items: list[InvoiceSummary]
    page: int
    page_size: int
    total_items: int
    total_pages: int


class InvoiceLine(BaseModel):
    name: str
    quantity: str
    unit_amount: str
    amount: str


class PaymentRecord(BaseModel):
    payment_id: str | None = None
    date: str | None = None
    method: str | None = None
    amount: str
    status: str | None = None


class InvoiceDetail(InvoiceSummary):
    items: list[InvoiceLine] = []
    invoice_date: str | None = None
    sent_at: str | None = None
    due_date: str | None = None
    payment_term: str | None = None
    note: str | None = None
    paid_amount: str = "0.00"
    due_amount: str | None = None
    payments: list[PaymentRecord] = []
