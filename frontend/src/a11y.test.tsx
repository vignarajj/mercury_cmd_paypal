// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedInvoice } from "./lib/types";

const PARSED: ParsedInvoice = {
  client_email: "buyer@personal.example.com",
  items: [{ name: "Brand refresh", quantity: 1, unit_amount: "1200.00" }, { name: "Icons", quantity: 1, unit_amount: "300.00" }],
  currency: "USD", due_days: 15, note: null, missing_fields: [], is_complete: true, warnings: ["Basic mode: single item only."], source: "llm",
};
const RESULT = { invoice_id: "INV2-AAAA-BBBB-CCCC-DDDD", invoice_url: "https://www.sandbox.paypal.com/invoice/p/#AAAABBBBCCCCDDDD", status: "SENT", client_email: "buyer@personal.example.com", total: "1500.00", currency: "USD" };

vi.mock("./lib/api", async (orig) => ({
  ...(await orig<typeof import("./lib/api")>()),
  api: {
    parse: vi.fn(async () => PARSED),
    createInvoice: vi.fn(async () => RESULT),
    resend: vi.fn(async () => RESULT),
    status: vi.fn(async () => ({ invoice_id: RESULT.invoice_id, status: "SENT", paid_at: null })),
  },
}));

import CommandPalette from "./components/CommandPalette";

beforeAll(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => localStorage.clear());
afterEach(cleanup);

// jsdom has no layout, so color contrast is covered separately by contrast.test.ts.
async function audit(label: string) {
  const r = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } }, runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] });
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(summary, `${label}: accessibility violations`).toEqual([]);
}

async function typeAndParse() {
  const input = screen.getByLabelText("Describe the invoice");
  fireEvent.change(input, { target: { value: "Invoice buyer@personal.example.com $1,200 for brand refresh and $300 for icons, net 15" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByLabelText("Invoice preview");
}

describe("accessibility (axe)", () => {
  it("empty state with examples and recent invoices", async () => {
    localStorage.setItem("mercury.recents.v1", JSON.stringify([
      { ...RESULT, url: RESULT.invoice_url, ts: Date.now() - 60_000 },
      { ...RESULT, invoice_id: "INV2-2", client_email: "second@client.io", status: "PAID", url: RESULT.invoice_url, ts: Date.now() - 3_600_000 },
    ]));
    render(<CommandPalette />);
    await screen.findByText("Recent invoices");
    await audit("empty state");
  });

  it("preview card", async () => {
    render(<CommandPalette />);
    await typeAndParse();
    await audit("preview");
  });

  it("preview with a missing email and the amber badge", async () => {
    const { api } = await import("./lib/api");
    vi.mocked(api.parse).mockResolvedValueOnce({ ...PARSED, client_email: null, missing_fields: ["client_email"], is_complete: false });
    render(<CommandPalette />);
    await typeAndParse();
    await screen.findByText(/Missing: email/);
    await audit("preview, missing email");
  });

  it("success card with the timeline", async () => {
    render(<CommandPalette />);
    await typeAndParse();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await screen.findByLabelText("Invoice sent", {}, { timeout: 4000 });
    await audit("success");
  });

  it("every interactive control has an accessible name", async () => {
    render(<CommandPalette />);
    await typeAndParse();
    const unnamed = [...document.querySelectorAll("button, input, select")].filter((el) => {
      const name = el.getAttribute("aria-label") || el.textContent?.trim() || (el as HTMLInputElement).labels?.[0]?.textContent?.trim();
      return !name;
    });
    expect(unnamed.map((e) => e.outerHTML.slice(0, 80))).toEqual([]);
  });

  it("Escape steps back from the preview", async () => {
    render(<CommandPalette />);
    await typeAndParse();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Invoice preview")).toBeNull());
  });
});
