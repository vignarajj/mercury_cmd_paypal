import { useCallback, useEffect, useReducer, useRef } from "react";
import { api, ApiError } from "../lib/api";
import { fromParsed, looksParseable, toRequest, validate, type Draft } from "../lib/invoice";
import type { InvoiceResult, ParsedInvoice } from "../lib/types";

export type Phase = "idle" | "parsing" | "preview" | "sending" | "success";
export interface UiError { code: string; message: string; retryable: boolean; invoiceId?: string }

export interface State {
  text: string;
  phase: Phase;
  draft: Draft | null;
  source: ParsedInvoice["source"] | null;
  warnings: string[];
  error: UiError | null;
  result: InvoiceResult | null;
  failedInvoiceId: string | null; // a draft exists at PayPal but sending failed: retry send, never re-create
  showErrors: boolean;
}

const initial: State = {
  text: "", phase: "idle", draft: null, source: null, warnings: [], error: null,
  result: null, failedInvoiceId: null, showErrors: false,
};

type Action =
  | { type: "text"; text: string }
  | { type: "parseStart" }
  | { type: "parseOk"; parsed: ParsedInvoice }
  | { type: "parseFail"; error: UiError }
  | { type: "edit"; draft: Draft }
  | { type: "showErrors" }
  | { type: "sendStart" }
  | { type: "sendOk"; result: InvoiceResult }
  | { type: "sendFail"; error: UiError }
  | { type: "back" }
  | { type: "dismissError" }
  | { type: "reset" };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "text": return { ...s, text: a.text, error: s.phase === "sending" ? s.error : null };
    case "parseStart": return { ...s, phase: "parsing", error: null };
    case "parseOk": {
      const p = a.parsed;
      if (!p.client_email && p.items.length === 0) {
        return { ...s, phase: "idle", draft: null, error: { code: "NOTHING_FOUND", retryable: false,
          message: "I couldn't find an email or an amount. Try: Bill client@acme.co $500 for logo design, net 15" } };
      }
      return { ...s, phase: "preview", draft: fromParsed(p), source: p.source, warnings: p.warnings, error: null,
        failedInvoiceId: null, showErrors: false, result: null };
    }
    case "parseFail": return { ...s, phase: s.draft ? "preview" : "idle", error: a.error };
    case "edit": return s.failedInvoiceId ? s : { ...s, draft: a.draft, error: null };
    case "showErrors": return { ...s, showErrors: true };
    case "sendStart": return { ...s, phase: "sending", error: null };
    case "sendOk": return { ...s, phase: "success", result: a.result, error: null, failedInvoiceId: null };
    case "sendFail": return { ...s, phase: "preview", error: a.error,
      failedInvoiceId: a.error.code === "SEND_FAILED" ? a.error.invoiceId ?? null : s.failedInvoiceId };
    case "back": return { ...s, phase: "idle", error: null };
    case "dismissError": return { ...s, error: null };
    case "reset": return initial;
  }
}

function toUiError(e: unknown): UiError {
  if (e instanceof ApiError) return { code: e.code, message: e.message, retryable: e.retryable, invoiceId: e.invoiceId };
  return { code: "UNKNOWN", message: "Something went wrong. Try again.", retryable: true };
}

const newId = () => crypto.randomUUID();

export function usePalette(seed?: Partial<State>) {
  const [state, dispatch] = useReducer(reducer, { ...initial, ...seed });
  const stateRef = useRef(state);
  stateRef.current = state;
  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(newId());
  const lastParsed = useRef("");

  const parse = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    lastParsed.current = trimmed;
    dispatch({ type: "parseStart" });
    try {
      const parsed = await api.parse(trimmed, ac.signal);
      requestId.current = newId();
      dispatch({ type: "parseOk", parsed });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      dispatch({ type: "parseFail", error: toUiError(e) });
    }
  }, []);

  // Debounced auto-parse: 600 ms pause, only when the text looks like an invoice sentence.
  useEffect(() => {
    const { text, phase } = state;
    if (phase === "sending" || phase === "success") return;
    if (!looksParseable(text) || text.trim() === lastParsed.current) return;
    const t = setTimeout(() => void parse(text), 600);
    return () => clearTimeout(t);
  }, [state.text, state.phase, parse]);

  const setText = useCallback((text: string) => {
    if (!looksParseable(text)) abortRef.current?.abort();
    dispatch({ type: "text", text });
  }, []);

  const edit = useCallback((draft: Draft) => {
    requestId.current = newId(); // payload changed: it is a different invoice, so a different idempotency key
    dispatch({ type: "edit", draft });
  }, []);

  const send = useCallback(async () => {
    const s = stateRef.current;
    if (s.phase !== "preview" || !s.draft) return;
    if (s.failedInvoiceId) return void retrySend();
    if (Object.keys(validate(s.draft)).length) return void dispatch({ type: "showErrors" });
    dispatch({ type: "sendStart" });
    try {
      dispatch({ type: "sendOk", result: await api.createInvoice(toRequest(s.draft, requestId.current)) });
    } catch (e) {
      dispatch({ type: "sendFail", error: toUiError(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retrySend = useCallback(async () => {
    const id = stateRef.current.failedInvoiceId;
    if (!id) return;
    dispatch({ type: "sendStart" });
    try {
      dispatch({ type: "sendOk", result: await api.resend(id) });
    } catch (e) {
      dispatch({ type: "sendFail", error: toUiError(e) });
    }
  }, []);

  const back = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: "back" });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    lastParsed.current = "";
    dispatch({ type: "reset" });
  }, []);

  return { state, dispatch, setText, parse, edit, send, retrySend, back, reset };
}
