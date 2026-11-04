// Dev-only: renders the real palette in fixed states for README and cover screenshots (see scripts/shots.sh).
import type { State } from "./hooks/usePalette";
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
  sent: { initial: { text: TEXT, phase: "success", result: RESULT("SENT") } },
  paid: { initial: { text: TEXT, phase: "success", result: RESULT("PAID") } },
};

/** Returns the seed for ?shots=<scene>&theme=<light|dark>, or null when not in showcase mode. */
export function showcaseFromUrl(): Partial<State> | null | undefined {
  const q = new URLSearchParams(location.search);
  const name = q.get("shots");
  if (!name || !SCENES[name]) return undefined;
  const theme = q.get("theme");
  if (theme === "light" || theme === "dark") applyMode(theme);
  document.documentElement.classList.add("shot");
  setTimeout(() => (document.activeElement as HTMLElement | null)?.blur?.(), 400); // show the start of the sentence, not the caret end
  const scene = SCENES[name];
  localStorage.setItem("mercury.recents.v1", JSON.stringify(scene.recents ? RECENTS : []));
  return scene.initial ?? null;
}
