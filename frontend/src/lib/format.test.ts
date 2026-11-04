import { describe, expect, it } from "vitest";
import { FILTERS, fmtDate, fmtDateTime, invoiceQueryString, pageRange, prettyHotkey, termLabel } from "./format";

describe("invoiceQueryString", () => {
  it("repeats status and trims the search text", () => {
    expect(invoiceQueryString({ page: 2, pageSize: 10, statuses: ["PAID", "MARKED_AS_PAID"], q: "  acme  " }))
      .toBe("page=2&page_size=10&status=PAID&status=MARKED_AS_PAID&q=acme");
  });
  it("omits empty filters", () => {
    expect(invoiceQueryString({ page: 1, pageSize: 10, statuses: [], q: "   " })).toBe("page=1&page_size=10");
  });
  it("encodes search text safely", () => {
    expect(invoiceQueryString({ page: 1, pageSize: 5, statuses: [], q: "a&b=c" })).toContain("q=a%26b%3Dc");
  });
});

describe("filters", () => {
  it("only use statuses the backend accepts", () => {
    const allowed = new Set(["DRAFT", "SENT", "SCHEDULED", "PAID", "MARKED_AS_PAID", "CANCELLED", "REFUNDED", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "MARKED_AS_REFUNDED", "UNPAID", "PAYMENT_PENDING"]);
    for (const f of FILTERS) for (const s of f.statuses) expect(allowed.has(s), s).toBe(true);
  });
});

describe("dates", () => {
  it("keeps a calendar date on the same day in every time zone", () => {
    expect(fmtDate("2026-11-03")).toBe("Nov 3, 2026");
  });
  it("formats instants and survives junk", () => {
    expect(fmtDateTime("2026-11-03T23:57:07Z")).toMatch(/Nov \d+, 2026/);
    expect(fmtDate(null)).toBe("–");
    expect(fmtDate("not a date")).toBe("–");
  });
});

describe("labels", () => {
  it("names payment terms and pretty-prints hotkeys", () => {
    expect(termLabel("NET_15")).toBe("Net 15");
    expect(termLabel("DUE_ON_RECEIPT")).toBe("Due on receipt");
    expect(termLabel(null)).toBe("No terms");
    expect(prettyHotkey("CommandOrControl+Shift+Space")).toBe("⌘⇧Space");
    expect(prettyHotkey("Alt+Space")).toBe("⌥Space");
  });
  it("describes the visible page range", () => {
    expect(pageRange(1, 10, 23, 10)).toBe("1–10 of 23");
    expect(pageRange(3, 10, 23, 3)).toBe("21–23 of 23");
    expect(pageRange(1, 10, 0, 0)).toBe("No invoices");
  });
});
