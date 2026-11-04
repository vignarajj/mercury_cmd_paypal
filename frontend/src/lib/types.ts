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
