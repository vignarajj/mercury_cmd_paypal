import { describe, expect, it } from "vitest";
import { addRecent, MAX_RECENTS, relativeTime, setRecentStatus, type Recent } from "./recents";
import type { InvoiceResult } from "./types";

const result = (id: string): InvoiceResult => ({ invoice_id: id, invoice_url: `https://www.sandbox.paypal.com/invoice/p/#${id}`, status: "SENT", client_email: "a@b.co", total: "10.00", currency: "USD" });

describe("recents", () => {
  it("puts the newest first and caps the list", () => {
    let list: Recent[] = [];
    for (let i = 0; i < MAX_RECENTS + 3; i++) list = addRecent(list, result(`INV-${i}`), 1000 + i);
    expect(list).toHaveLength(MAX_RECENTS);
    expect(list[0].invoice_id).toBe(`INV-${MAX_RECENTS + 2}`);
  });
  it("does not duplicate an invoice that is added twice", () => {
    const list = addRecent(addRecent([], result("INV-1")), result("INV-1"));
    expect(list).toHaveLength(1);
  });
  it("updates a status without touching other rows, and keeps identity when nothing changes", () => {
    const list = addRecent(addRecent([], result("INV-1")), result("INV-2"));
    const next = setRecentStatus(list, "INV-1", "PAID");
    expect(next.find((r) => r.invoice_id === "INV-1")?.status).toBe("PAID");
    expect(next.find((r) => r.invoice_id === "INV-2")?.status).toBe("SENT");
    expect(setRecentStatus(next, "INV-1", "PAID")).toBe(next);
  });
  it.each([[10_000, "just now"], [5 * 60_000, "5m ago"], [3 * 3_600_000, "3h ago"], [2 * 86_400_000, "2d ago"]])("relativeTime %i", (ms, label) => {
    expect(relativeTime(0, ms)).toBe(label);
  });
});
