// Mirrors backend/app/models.py. Amounts are 2-decimal strings, never floats.
export interface ParsedItem { name: string; quantity: number; unit_amount: string }

export interface ParsedInvoice {
  client_email: string | null;
  items: ParsedItem[];
  currency: string;
  due_days: number | null;
  note: string | null;
  missing_fields: string[];
  is_complete: boolean;
  warnings: string[];
  source: "llm" | "regex";
}

export interface InvoiceResult {
  invoice_id: string;
  invoice_url: string;
  status: string;
  client_email: string;
  total: string;
  currency: string;
}

export interface InvoiceStatus { invoice_id: string; status: string; paid_at: string | null }

// ---- Dashboard (history, detail, settings)
export interface InvoiceSummary {
  invoice_id: string; number: string | null; status: string; client_email: string;
  total: string; currency: string; created_at: string | null; invoice_url: string;
}
export interface InvoiceList { items: InvoiceSummary[]; page: number; page_size: number; total_items: number; total_pages: number }
export interface InvoiceLine { name: string; quantity: string; unit_amount: string; amount: string }
export interface PaymentRecord { payment_id: string | null; date: string | null; method: string | null; amount: string; status: string | null }
export interface InvoiceDetail extends InvoiceSummary {
  items: InvoiceLine[]; invoice_date: string | null; sent_at: string | null; due_date: string | null; payment_term: string | null;
  note: string | null; paid_amount: string; due_amount: string | null; payments: PaymentRecord[];
}
export interface BackendInfo {
  version: string;
  paypal: { status: "ok" | "error"; error: string | null; host: string; mode: string; merchant_email: string | null };
  llm: { provider: string; model: string | null; status: "ok" | "model_missing" | "offline" | "disabled" };
}
export interface ModelState {
  provider: string;
  status: "ok" | "model_missing" | "offline" | "disabled";
  current: string | null;
  default: string;
  base_url: string | null;
  models: { name: string; size_bytes: number | null; parameters: string | null }[];
  unavailable: { name: string; reason: "cloud" | "embedding" }[];
}
