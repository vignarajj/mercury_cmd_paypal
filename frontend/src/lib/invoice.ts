import type { ParsedInvoice, ParsedItem } from "./types";

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;
export const MAX_ITEMS = 10;

/** What the user edits. Amounts stay as strings so typing "12." never gets mangled. */
export interface Draft {
  client_email: string;
  items: { name: string; quantity: string; unit_amount: string }[];
  currency: string;
  due_days: number | null;
  note: string | null;
}

export const DUE_PRESETS: { value: number | null; label: string }[] = [
  { value: null, label: "No terms" },
  { value: 0, label: "Due on receipt" },
  { value: 7, label: "Due in 7 days" },
  { value: 15, label: "Net 15" },
  { value: 30, label: "Net 30" },
  { value: 45, label: "Net 45" },
  { value: 60, label: "Net 60" },
];

export function dueOptions(current: number | null) {
  if (current === null || DUE_PRESETS.some((p) => p.value === current)) return DUE_PRESETS;
  return [...DUE_PRESETS, { value: current, label: `Due in ${current} days` }];
}

export function fromParsed(p: ParsedInvoice): Draft {
  return {
    client_email: p.client_email ?? "",
    items: p.items.map((i: ParsedItem) => ({ name: i.name, quantity: String(i.quantity), unit_amount: i.unit_amount })),
    currency: p.currency,
    due_days: p.due_days,
    note: p.note,
  };
}

/** "1,200.5" -> 120050 (integer cents) or null if not a positive amount. String math: no float drift. */
export function toCents(input: string): number | null {
  const s = input.replace(/[,$€£\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

export function lineCents(i: Draft["items"][number]): number | null {
  const unit = toCents(i.unit_amount);
  const qty = Number(i.quantity);
  return unit !== null && Number.isInteger(qty) && qty >= 1 && qty <= 1000 ? unit * qty : null;
}

export function totalCents(d: Draft): number {
  return d.items.reduce((sum, i) => sum + (lineCents(i) ?? 0), 0);
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validate(d: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!EMAIL.test(d.client_email.trim())) errors.client_email = d.client_email.trim() ? "Not a valid email" : "Missing email";
  if (d.items.length === 0) errors.items = "Add at least one item";
  d.items.forEach((it, n) => {
    if (!it.name.trim()) errors[`items.${n}.name`] = "Missing description";
    if (toCents(it.unit_amount) === null) errors[`items.${n}.unit_amount`] = "Enter an amount above 0";
    if (lineCents(it) === null && toCents(it.unit_amount) !== null) errors[`items.${n}.quantity`] = "Quantity 1-1000";
  });
  return errors;
}

/** Payload for POST /api/invoice. Assumes validate() returned no errors. */
export function toRequest(d: Draft, requestId: string) {
  return {
    client_email: d.client_email.trim(),
    items: d.items.map((i) => ({
      name: i.name.trim(),
      quantity: Number(i.quantity),
      unit_amount: (toCents(i.unit_amount)! / 100).toFixed(2),
    })),
    currency: d.currency,
    due_days: d.due_days,
    note: d.note,
    request_id: requestId,
  };
}

/** Parse only when it looks like an invoice sentence: an email and a digit (spec section 7). */
export const looksParseable = (text: string) => text.includes("@") && /\d/.test(text);

export const FINAL_STATUSES = new Set(["PAID", "MARKED_AS_PAID", "CANCELLED", "REFUNDED"]);
