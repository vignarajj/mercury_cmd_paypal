import { describe, expect, it } from "vitest";
import { dueOptions, fromParsed, looksParseable, toCents, toRequest, totalCents, validate, type Draft } from "./invoice";

const draft = (over: Partial<Draft> = {}): Draft => ({
  client_email: "a@b.co",
  items: [{ name: "Logo", quantity: "1", unit_amount: "500.00" }],
  currency: "USD",
  due_days: 15,
  note: null,
  ...over,
});

describe("toCents", () => {
  it.each([["1,200.50", 120050], ["$99.99", 9999], ["12", 1200], ["0.1", 10], ["1000000", 100000000]])("%s -> %s", (s, c) => {
    expect(toCents(s)).toBe(c);
  });
  it.each(["", "0", "-5", "abc", "1.234", "1000000.01", "12."])("rejects %j", (s) => {
    expect(toCents(s) ?? null).toBe(s === "12." ? 1200 : null);
  });
  it("has no float drift", () => {
    expect(totalCents(draft({ items: [{ name: "x", quantity: "3", unit_amount: "0.10" }, { name: "y", quantity: "1", unit_amount: "19.99" }] }))).toBe(2029);
  });
});

describe("validate", () => {
  it("accepts a good draft", () => expect(validate(draft())).toEqual({}));
  it("flags missing and invalid email", () => {
    expect(validate(draft({ client_email: "" })).client_email).toBe("Missing email");
    expect(validate(draft({ client_email: "nope" })).client_email).toBe("Not a valid email");
  });
  it("flags empty items, blank names, bad amounts and quantities", () => {
    expect(validate(draft({ items: [] })).items).toBeTruthy();
    const e = validate(draft({ items: [{ name: " ", quantity: "0", unit_amount: "x" }] }));
    expect(e["items.0.name"]).toBeTruthy();
    expect(e["items.0.unit_amount"]).toBeTruthy();
    const q = validate(draft({ items: [{ name: "a", quantity: "0", unit_amount: "5" }] }));
    expect(q["items.0.quantity"]).toBeTruthy();
  });
});

describe("toRequest / fromParsed", () => {
  it("normalizes amounts to 2 decimals and carries the request id", () => {
    const r = toRequest(draft({ items: [{ name: " Logo ", quantity: "2", unit_amount: "1,200.5" }] }), "req-1");
    expect(r.items).toEqual([{ name: "Logo", quantity: 2, unit_amount: "1200.50" }]);
    expect(r.request_id).toBe("req-1");
  });
  it("round-trips parsed output", () => {
    const d = fromParsed({ client_email: null, items: [{ name: "A", quantity: 3, unit_amount: "10.00" }], currency: "EUR",
      due_days: 30, note: null, missing_fields: ["client_email"], is_complete: false, warnings: [], source: "llm" });
    expect(d).toMatchObject({ client_email: "", currency: "EUR", due_days: 30 });
    expect(d.items[0]).toEqual({ name: "A", quantity: "3", unit_amount: "10.00" });
  });
});

describe("misc", () => {
  it("auto-parse trigger needs an email and a digit", () => {
    expect(looksParseable("bill a@b.co $5")).toBe(true);
    expect(looksParseable("bill a@b.co")).toBe(false);
    expect(looksParseable("bill $5")).toBe(false);
  });
  it("adds a custom due option when the parser returns an unusual value", () => {
    expect(dueOptions(15).length).toBe(dueOptions(null).length);
    expect(dueOptions(21)[dueOptions(21).length - 1]).toEqual({ value: 21, label: "Due in 21 days" });
  });
});
