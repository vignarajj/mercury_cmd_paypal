export interface InvoiceQuery { page: number; pageSize: number; statuses: string[]; q: string }

export const PAGE_SIZE = 10;

/** Filter chips on the Invoices screen, mapped to PayPal invoice statuses. */
export const FILTERS = [
  { id: "all", label: "All", statuses: [] as string[] },
  { id: "open", label: "Awaiting payment", statuses: ["SENT", "UNPAID", "PAYMENT_PENDING", "PARTIALLY_PAID"] },
  { id: "paid", label: "Paid", statuses: ["PAID", "MARKED_AS_PAID"] },
  { id: "draft", label: "Draft or scheduled", statuses: ["DRAFT", "SCHEDULED"] },
  { id: "closed", label: "Cancelled or refunded", statuses: ["CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "MARKED_AS_REFUNDED"] },
] as const;

export function invoiceQueryString({ page, pageSize, statuses, q }: InvoiceQuery): string {
  const p = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  statuses.forEach((s) => p.append("status", s));
  if (q.trim()) p.set("q", q.trim());
  return p.toString();
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(iso: string): Date {
  if (DATE_ONLY.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d); // a calendar date, not an instant: do not shift it by the time zone
  }
  return new Date(iso);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = toDate(iso);
  return Number.isNaN(d.getTime()) ? "–" : new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(d);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

export function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = toDate(iso);
  return Number.isNaN(d.getTime()) ? "–" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

const TERMS: Record<string, string> = {
  DUE_ON_RECEIPT: "Due on receipt", NO_DUE_DATE: "No due date", DUE_ON_DATE_SPECIFIED: "Due on a set date",
  NET_10: "Net 10", NET_15: "Net 15", NET_30: "Net 30", NET_45: "Net 45", NET_60: "Net 60", NET_90: "Net 90",
};
export const termLabel = (term: string | null) => (term ? TERMS[term] ?? term : "No terms");

/** "CommandOrControl+Shift+Space" -> "⌘⇧Space" */
export function prettyHotkey(hotkey: string): string {
  const map: Record<string, string> = { CommandOrControl: "⌘", CmdOrCtrl: "⌘", Command: "⌘", Cmd: "⌘", Super: "⌘", Control: "⌃", Ctrl: "⌃", Shift: "⇧", Alt: "⌥", Option: "⌥" };
  return hotkey.split("+").map((p) => map[p] ?? p).join("");
}

export const pageRange = (page: number, pageSize: number, total: number, shown: number) =>
  total === 0 ? "No invoices" : `${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + shown} of ${total}`;
