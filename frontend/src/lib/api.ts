import { invoiceQueryString, type InvoiceQuery } from "./format";
import type { BackendInfo, InvoiceDetail, InvoiceList, InvoiceResult, InvoiceStatus, ParsedInvoice } from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:47891";
const TOKEN = import.meta.env.VITE_MERCURY_TOKEN ?? "";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public invoiceId?: string,
    public fields: string[] = [],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      signal,
      headers: { "Content-Type": "application/json", "X-Mercury-Token": TOKEN, ...init.headers },
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("BACKEND_DOWN", "Mercury's backend isn't running. Start it with `make backend`.", true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = body.error ?? {};
    throw new ApiError(err.code ?? "UNKNOWN", err.message ?? `Request failed (${res.status})`, !!err.retryable, err.invoice_id, err.fields);
  }
  return res.json();
}

export const api = {
  parse: (text: string, signal?: AbortSignal) =>
    request<ParsedInvoice>("/api/parse", { method: "POST", body: JSON.stringify({ text }) }, signal),
  createInvoice: (payload: unknown) =>
    request<InvoiceResult>("/api/invoice", { method: "POST", body: JSON.stringify(payload) }),
  resend: (invoiceId: string) =>
    request<InvoiceResult>(`/api/invoice/${invoiceId}/send`, { method: "POST" }),
  status: (invoiceId: string) => request<InvoiceStatus>(`/api/invoice/${invoiceId}`),
  invoices: (query: InvoiceQuery, signal?: AbortSignal) => request<InvoiceList>(`/api/invoices?${invoiceQueryString(query)}`, {}, signal),
  invoiceDetail: (invoiceId: string, signal?: AbortSignal) => request<InvoiceDetail>(`/api/invoice/${invoiceId}/detail`, {}, signal),
  info: (signal?: AbortSignal) => request<BackendInfo>("/api/info", {}, signal),
};
