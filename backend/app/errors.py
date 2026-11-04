"""Domain errors that map 1:1 to the API error shape in the execution spec (section 3)."""


class MercuryError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        http_status: int = 400,
        *,
        invoice_id: str | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.invoice_id = invoice_id
        self.retryable = retryable

    def to_body(self) -> dict:
        err: dict = {"code": self.code, "message": self.message, "retryable": self.retryable}
        if self.invoice_id:
            err["invoice_id"] = self.invoice_id
        return {"error": err}
