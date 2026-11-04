// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedInvoice } from "./lib/types";

const PARSED: ParsedInvoice = {
  client_email: "buyer@personal.example.com", items: [{ name: "Brand refresh", quantity: 1, unit_amount: "1200.00" }], currency: "USD",
  due_days: 15, note: null, missing_fields: [], is_complete: true, warnings: [], source: "llm",
};
const RESULT = { invoice_id: "INV2-AAAA-BBBB-CCCC-DDDD", invoice_url: "https://www.sandbox.paypal.com/invoice/p/#AAAABBBBCCCCDDDD", status: "SENT", client_email: "buyer@personal.example.com", total: "1200.00", currency: "USD" };

vi.mock("./lib/api", async (orig) => ({
  ...(await orig<typeof import("./lib/api")>()),
  api: {
    parse: vi.fn(async () => PARSED), createInvoice: vi.fn(async () => RESULT), resend: vi.fn(async () => RESULT),
    status: vi.fn(async () => ({ invoice_id: RESULT.invoice_id, status: "SENT", paid_at: null })),
  },
}));
import { api } from "./lib/api";
import CommandPalette from "./components/CommandPalette";

beforeAll(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => { localStorage.clear(); vi.mocked(api.parse).mockClear(); });
afterEach(cleanup);

const input = () => screen.getByLabelText("Describe the invoice") as HTMLInputElement;

async function sendOne() {
  fireEvent.change(input(), { target: { value: "Invoice buyer@personal.example.com $1,200 for brand refresh, net 15" } });
  fireEvent.keyDown(input(), { key: "Enter" });
  await screen.findByLabelText("Invoice preview");
  fireEvent.keyDown(window, { key: "Enter", metaKey: true });
  await screen.findByLabelText("Invoice sent", {}, { timeout: 4000 });
}

describe("after an invoice is sent", () => {
  it("clears the old sentence so the box is ready for the next one", async () => {
    render(<CommandPalette />);
    await sendOne();
    expect(input().value).toBe("");
    expect(input().placeholder).toBe("Type to start another invoice");
  });

  it("starts a new invoice as soon as you type, with no Esc needed", async () => {
    render(<CommandPalette />);
    await sendOne();
    fireEvent.change(input(), { target: { value: "Bill dev@startup.com $90 for hosting" } });
    await waitFor(() => expect(screen.queryByLabelText("Invoice sent")).toBeNull()); // the old card fades out
    await waitFor(() => expect(api.parse).toHaveBeenCalledTimes(2), { timeout: 3000 }); // auto-read after the pause
    expect(await screen.findByLabelText("Invoice preview")).toBeTruthy();
  });

  it("Esc starts over and keeps the palette open; the next Esc is what closes it", async () => {
    render(<CommandPalette />);
    await sendOne();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Invoice sent")).toBeNull());
    expect(screen.getByRole("main", { name: "Mercury Cmd" })).toBeTruthy(); // still here
    expect(screen.getByText("Try an example")).toBeTruthy();
    expect(document.activeElement).toBe(input());
  });

  it("⌘N starts a new invoice from any state", async () => {
    render(<CommandPalette />);
    fireEvent.change(input(), { target: { value: "Invoice buyer@personal.example.com $1,200 for brand refresh" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await screen.findByLabelText("Invoice preview");
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    await waitFor(() => expect(screen.queryByLabelText("Invoice preview")).toBeNull());
    expect(input().value).toBe("");
  });

  it("keeps the sent invoice in Recent invoices after starting over", async () => {
    render(<CommandPalette />);
    await sendOne();
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(await screen.findByText("Recent invoices")).toBeTruthy();
    expect(screen.getByText("buyer@personal.example.com")).toBeTruthy();
  });
});

describe("footer controls", () => {
  it("has a Dashboard button, and no pin button in the browser (pinning is a desktop-window feature)", () => {
    render(<CommandPalette />);
    expect(screen.getByRole("button", { name: "Open the Dashboard" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /pin/i })).toBeNull();
  });
});
