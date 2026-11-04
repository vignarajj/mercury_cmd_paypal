"""FastAPI entrypoint. Run with:  uvicorn app.main:create_app --factory --host 127.0.0.1 --port 47891"""
import asyncio
import logging
import secrets
from contextlib import asynccontextmanager

import httpx
from fastapi import APIRouter, Depends, FastAPI, Header, Path, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import DEFAULT_MODEL, Settings, get_settings
from .errors import MercuryError
from .models import (
    LIST_STATUSES, InvoiceDetail, InvoiceList, InvoiceRequest, InvoiceResult, InvoiceStatus, CloudChoice, ModelChoice, ParsedInvoice, ParseRequest,
)
from .services.ai_service import OllamaClient, ParseService
from .services.paypal_service import PayPalService
from .services.prefs import Preferences

log = logging.getLogger("mercury")

INVOICE_ID = Path(pattern=r"^[A-Za-z0-9-]{8,64}$", description="PayPal invoice id")


def create_app(
    settings: Settings | None = None, http_client: httpx.AsyncClient | None = None, prefs: Preferences | None = None,
) -> FastAPI:
    s = settings or get_settings()
    prefs = prefs or Preferences()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = http_client or httpx.AsyncClient(timeout=15)
        app.state.settings = s
        app.state.paypal = PayPalService(s, client)
        app.state.ollama = OllamaClient(s, client) if s.llm_provider == "ollama" else None
        saved = prefs.ollama_model
        if app.state.ollama and saved and (prefs.allow_cloud or not saved.endswith(":cloud")):
            app.state.ollama.model = saved  # the model picked in Settings wins over OLLAMA_MODEL
        app.state.parser = ParseService(app.state.ollama)
        warm = asyncio.create_task(app.state.ollama.warm_up()) if app.state.ollama else None
        yield
        if warm:
            warm.cancel()
        if http_client is None:
            await client.aclose()

    app = FastAPI(title="Mercury Cmd", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=s.allowed_origins_regex,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-Mercury-Token"],
    )

    @app.exception_handler(MercuryError)
    async def _mercury_error(_: Request, exc: MercuryError) -> JSONResponse:
        return JSONResponse(status_code=exc.http_status, content=exc.to_body())

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error", exc_info=exc)
        return JSONResponse(status_code=500, content={"error": {
            "code": "INTERNAL", "message": "Something went wrong on the backend. Check its log.", "retryable": True}})

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [".".join(str(p) for p in e["loc"] if p not in ("body", "path", "query")) for e in exc.errors()]
        first = exc.errors()[0] if exc.errors() else {}
        msg = str(first.get("msg", "Invalid input")).removeprefix("Value error, ")
        where = fields[0] if fields and fields[0] else None
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "INVALID_INPUT", "message": f"{where}: {msg}" if where else msg,
                               "fields": [f for f in fields if f], "retryable": False}},
        )

    def paypal(request: Request) -> PayPalService:
        return request.app.state.paypal

    async def require_token(request: Request, x_mercury_token: str | None = Header(default=None)) -> None:
        expected = request.app.state.settings.mercury_token
        if not x_mercury_token or not secrets.compare_digest(x_mercury_token, expected):
            raise MercuryError("UNAUTHORIZED", "Missing or invalid X-Mercury-Token.", 401)

    api = APIRouter(prefix="/api", dependencies=[Depends(require_token)])

    @api.post("/parse", response_model=ParsedInvoice)
    async def parse(body: ParseRequest, request: Request) -> ParsedInvoice:
        return await request.app.state.parser.parse(body.text)

    @api.post("/invoice", response_model=InvoiceResult)
    async def create_invoice(body: InvoiceRequest, svc: PayPalService = Depends(paypal)) -> InvoiceResult:
        return await svc.create_and_send(body)

    @api.get("/invoices", response_model=InvoiceList)
    async def list_invoices(
        page: int = Query(1, ge=1, le=500),
        page_size: int = Query(20, ge=1, le=100),
        status: list[str] = Query(default=[]),
        q: str | None = Query(default=None, max_length=120),
        svc: PayPalService = Depends(paypal),
    ) -> InvoiceList:
        bad = [x for x in status if x not in LIST_STATUSES]
        if bad:
            raise MercuryError("INVALID_INPUT", f"status: unknown value {bad[0]}", 422)
        return await svc.list_invoices(page=page, page_size=page_size, status=status, q=q)

    @api.get("/invoice/{invoice_id}/detail", response_model=InvoiceDetail)
    async def invoice_detail(invoice_id: str = INVOICE_ID, svc: PayPalService = Depends(paypal)) -> InvoiceDetail:
        return await svc.invoice_detail(invoice_id)

    @api.get("/info")
    async def info(request: Request) -> dict:
        """Read-only configuration and live health for the Settings screen. Never includes secrets."""
        state = request.app.state
        try:
            await state.paypal.get_token()
            paypal_state = "ok"
        except MercuryError as exc:
            paypal_state = "error"
            paypal_error = exc.message
        else:
            paypal_error = None
        llm_state = await state.ollama.health() if state.ollama else "disabled"
        return {
            "version": app.version,
            "paypal": {"status": paypal_state, "error": paypal_error, "host": s.paypal_api_base, "mode": "sandbox",
                       "merchant_email": s.merchant_email or None},
            "llm": {"provider": s.llm_provider, "model": state.ollama.model if state.ollama else None, "status": llm_state},
        }

    async def model_state(request: Request) -> dict:
        ollama = request.app.state.ollama
        if ollama is None:
            return {"provider": s.llm_provider, "status": "disabled", "current": None, "default": DEFAULT_MODEL,
                    "base_url": None, "allow_cloud": False, "models": [], "unavailable": []}
        found = await ollama.installed_models(prefs.allow_cloud)
        status = "offline" if found is None else await ollama.health()
        usable, unavailable = found or ([], [])
        return {"provider": "ollama", "status": status, "current": ollama.model, "default": DEFAULT_MODEL,
                "base_url": s.ollama_base_url, "allow_cloud": prefs.allow_cloud, "models": usable, "unavailable": unavailable}

    @api.get("/models")
    async def list_models(request: Request) -> dict:
        """Models installed in the local Ollama, for the Settings picker."""
        return await model_state(request)

    @api.post("/model")
    async def choose_model(body: ModelChoice, request: Request) -> dict:
        """Switch the parsing model without restarting. Cloud models are accepted only after the opt-in."""
        ollama = request.app.state.ollama
        if ollama is None:
            raise MercuryError("LLM_DISABLED", "AI parsing is turned off (LLM_PROVIDER=none in backend/.env).", 409)
        found = await ollama.installed_models(prefs.allow_cloud)
        if found is None:
            raise MercuryError("LLM_OFFLINE", "Ollama isn't running. Start it, then choose a model.", 503, retryable=True)
        if any(m["name"] == body.model and m["reason"] == "cloud" for m in found[1]):
            raise MercuryError("CLOUD_NOT_ALLOWED",
                               f"{body.model} runs on ollama.com. Turn on \"Allow cloud models\" in Settings first.", 422)
        if body.model not in {m["name"] for m in found[0]}:
            raise MercuryError("MODEL_NOT_INSTALLED",
                               f"{body.model} isn't installed locally. Run: ollama pull {body.model}", 422)
        ollama.model = body.model
        prefs.set_ollama_model(body.model)
        request.app.state.warm_task = asyncio.create_task(ollama.warm_up())  # load it now so the next invoice is not slow
        return await model_state(request)

    @api.post("/cloud")
    async def allow_cloud(body: CloudChoice, request: Request) -> dict:
        """Opt in or out of cloud models (they run on ollama.com, so the invoice text leaves this computer).

        Turning it off while a cloud model is selected falls back to a local model right away.
        """
        ollama = request.app.state.ollama
        if ollama is None:
            raise MercuryError("LLM_DISABLED", "AI parsing is turned off (LLM_PROVIDER=none in backend/.env).", 409)
        prefs.set_allow_cloud(body.allow)
        if not body.allow:
            found = await ollama.installed_models(True)
            everything = found[0] if found else []
            if ollama.model.endswith(":cloud") or any(m["name"] == ollama.model and m["cloud"] for m in everything):
                local = [m["name"] for m in everything if not m["cloud"]]
                ollama.model = s.ollama_model if s.ollama_model in local or not local else local[0]
                prefs.set_ollama_model(ollama.model)
                request.app.state.warm_task = asyncio.create_task(ollama.warm_up())
        return await model_state(request)

    @api.post("/invoice/{invoice_id}/send", response_model=InvoiceResult)
    async def resend_invoice(invoice_id: str = INVOICE_ID, svc: PayPalService = Depends(paypal)) -> InvoiceResult:
        return await svc.resend(invoice_id)

    @api.get("/invoice/{invoice_id}", response_model=InvoiceStatus)
    async def invoice_status(invoice_id: str = INVOICE_ID, svc: PayPalService = Depends(paypal)) -> InvoiceStatus:
        return await svc.status(invoice_id)

    app.include_router(api)

    @app.get("/api/health")
    async def health(request: Request) -> dict:
        """Open (no token): returns no secrets, used by the UI to say 'backend not running'."""
        try:
            await request.app.state.paypal.get_token()
            paypal_state = "ok"
        except MercuryError:
            paypal_state = "error"
        ollama = request.app.state.ollama
        llm_state = await ollama.health() if ollama else "disabled"
        return {"paypal": paypal_state, "llm": llm_state, "mode": "llm" if llm_state == "ok" else "regex"}

    return app
