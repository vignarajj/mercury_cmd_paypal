// Dev-only: renders the real palette in fixed states for README and cover screenshots (see scripts/shots.sh).
import type { State } from "./hooks/usePalette";
import { api } from "./lib/api";
import type { BackendInfo, InvoiceDetail, InvoiceSummary } from "./lib/types";
import { applyMode } from "./lib/theme";

const NOW = Date.now();
const RECENTS = [
  { invoice_id: "INV2-DEMO-0001", client_email: "sarah@studio.io", total: "1500.00", currency: "USD", status: "PAID", url: "https://www.sandbox.paypal.com/invoice/p/#DEMO0001", ts: NOW - 26 * 60_000 },
  { invoice_id: "INV2-DEMO-0002", client_email: "dev@startup.com", total: "300.00", currency: "USD", status: "SENT", url: "https://www.sandbox.paypal.com/invoice/p/#DEMO0002", ts: NOW - 3 * 3_600_000 },
  { invoice_id: "INV2-DEMO-0003", client_email: "billing@northwind.co", total: "2400.00", currency: "EUR", status: "SENT", url: "https://www.sandbox.paypal.com/invoice/p/#DEMO0003", ts: NOW - 28 * 3_600_000 },
];
const TEXT = "Invoice sarah@studio.io $1,200 for brand refresh and $300 for icons, net 30";
const DRAFT = {
  client_email: "sarah@studio.io",
  items: [{ name: "Brand refresh", quantity: "1", unit_amount: "1200.00" }, { name: "Icons", quantity: "1", unit_amount: "300.00" }],
  currency: "USD", due_days: 30, note: null,
};
const RESULT = (status: string) => ({ invoice_id: "INV2-K7QM-4XWB-9TCE-2RDL", invoice_url: "https://www.sandbox.paypal.com/invoice/p/#K7QM4XWB9TCE2RDL", status, client_email: "sarah@studio.io", total: "1500.00", currency: "USD" });

export const SCENES: Record<string, { initial?: Partial<State>; recents?: boolean }> = {
  empty: { recents: true },
  anatomy: { initial: { text: "Bill sarah@studio.io $1,200 for brand refresh, net 30" } },
  reading: { initial: { text: TEXT, phase: "parsing" } },
  preview: { initial: { text: TEXT, phase: "preview", draft: DRAFT, source: "llm", warnings: [] } },
  sent: { initial: { text: "", phase: "success", result: RESULT("SENT") } }, // the real app clears the box after a send
  paid: { initial: { text: "", phase: "success", result: RESULT("PAID") } },
};

// ---- Dashboard scenes: the real screens fed with made-up data, so screenshots never show a real account.
const DASH_ROUTES: Record<string, string> = { "dash-invoices": "#/dashboard", "dash-settings": "#/dashboard/settings" };
const D = (n: number, email: string, total: string, status: string, day: string): InvoiceSummary => ({
  invoice_id: `INV2-DEMO-${String(n).padStart(4, "0")}`, number: String(n).padStart(4, "0"), status, client_email: email, total, currency: "USD",
  created_at: `2026-11-${day}T10:00:00Z`, invoice_url: `https://www.sandbox.paypal.com/invoice/p/#DEMO${n}`,
});
const DASH_ROWS = [
  D(8, "sarah@studio.io", "1500.00", "PAID", "04"), D(7, "dev@startup.com", "300.00", "SENT", "04"), D(6, "billing@northwind.co", "2400.00", "SENT", "03"),
  D(5, "amy@corp.com", "350.00", "PAID", "03"), D(4, "mike@studio.io", "500.00", "SENT", "02"), D(3, "jane@x.org", "90.00", "PAID", "02"),
  D(2, "ops@harbor.dev", "1200.00", "SCHEDULED", "01"), D(1, "ceo@bigcorp.com", "75.00", "CANCELLED", "01"),
];
const DASH_INFO: BackendInfo = {
  version: "0.1.0",
  paypal: { status: "ok", error: null, host: "https://api-m.sandbox.paypal.com", mode: "sandbox", merchant_email: "merchant@business.example.com" },
  llm: { provider: "ollama", model: "gemma4:e2b-it-qat", status: "ok" },
};
const dashDetail = (s: InvoiceSummary): InvoiceDetail => {
  const paid = s.status === "PAID";
  return {
    ...s, invoice_date: "2026-11-04", sent_at: "2026-11-04T10:00:03Z", due_date: "2026-11-19", payment_term: "NET_15", note: null,
    items: s.invoice_id.endsWith("0008")
      ? [{ name: "Brand refresh", quantity: "1", unit_amount: "1200.00", amount: "1200.00" }, { name: "Icons", quantity: "1", unit_amount: "300.00", amount: "300.00" }]
      : [{ name: "Consulting", quantity: "3", unit_amount: (Number(s.total) / 3).toFixed(2), amount: s.total }],
    paid_amount: paid ? s.total : "0.00", due_amount: paid ? "0.00" : s.total,
    payments: paid ? [{ payment_id: "4WP26199BT233190J", date: "2026-11-04T12:41:07Z", method: "PAYPAL", amount: s.total, status: "SUCCESS" }] : [],
  };
};

function installDashboardMocks() {
  Object.assign(api, {
    invoices: async () => ({ items: DASH_ROWS, page: 1, page_size: 10, total_items: DASH_ROWS.length, total_pages: 1 }),
    invoiceDetail: async (id: string) => dashDetail(DASH_ROWS.find((r) => r.invoice_id === id) ?? DASH_ROWS[0]),
    info: async () => DASH_INFO,
  });
}

/** Returns the seed for ?shots=<scene>&theme=<light|dark>, or null when not in showcase mode. */
export function showcaseFromUrl(): Partial<State> | null | undefined {
  const q = new URLSearchParams(location.search);
  const name = q.get("shots");
  if (name && DASH_ROUTES[name]) {
    const theme = q.get("theme");
    if (theme === "light" || theme === "dark") applyMode(theme);
    document.documentElement.classList.add("shot");
    localStorage.setItem("mercury.recents.v1", JSON.stringify(RECENTS));
    installDashboardMocks();
    location.hash = DASH_ROUTES[name];
    return null;
  }
  if (!name || !SCENES[name]) return undefined;
  const theme = q.get("theme");
  if (theme === "light" || theme === "dark") applyMode(theme);
  document.documentElement.classList.add("shot");
  setTimeout(() => (document.activeElement as HTMLElement | null)?.blur?.(), 400); // show the start of the sentence, not the caret end
  const scene = SCENES[name];
  localStorage.setItem("mercury.recents.v1", JSON.stringify(scene.recents ? RECENTS : []));
  return scene.initial ?? null;
}
