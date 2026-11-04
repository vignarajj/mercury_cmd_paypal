import { describe, expect, it } from "vitest";
import { tokenize } from "./entities";

const kinds = (t: string) => tokenize(t).filter((s) => s.kind !== "text").map((s) => [s.kind, s.text]);

describe("tokenize", () => {
  it("marks email, amounts and terms in a full sentence", () => {
    expect(kinds("Bill sarah@acme.co $1,200 for brand refresh and $300 for icons, net 15")).toEqual([
      ["email", "sarah@acme.co"], ["amount", "$1,200"], ["amount", "$300"], ["term", "net 15"],
    ]);
  });
  it("never loses or reorders text", () => {
    for (const t of ["", "hello", "a@b.co $5 for x net 30", "  weird   spacing  $5  ", "€500 and £90 due on receipt"]) {
      expect(tokenize(t).map((s) => s.text).join("")).toBe(t);
    }
  });
  it("does not mistake digits inside an email for an amount", () => {
    expect(kinds("bill client2@corp.com for audit")).toEqual([["email", "client2@corp.com"]]);
  });
  it.each([
    ["bill a@b.co €500 for logo", "€500"], ["bill a@b.co 450 USD for seo", "450 USD"], ["bill a@b.co EUR 800 for x", "EUR 800"],
    ["bill a@b.co $1.5k for api", "$1.5k"], ["bill a@b.co 2k for page", "2k"],
  ])("recognizes the amount in %j", (text, amount) => {
    expect(kinds(text).find(([k]) => k === "amount")?.[1]).toBe(amount);
  });
  it("with several bare numbers highlights only the largest, like the backend", () => {
    expect(kinds("invoice a@b.co 350 for design sprint 2").filter(([k]) => k === "amount")).toEqual([["amount", "350"]]);
  });
  it("a marked amount wins over bare numbers", () => {
    expect(kinds("a@b.co $350 for sprint 2").filter(([k]) => k === "amount")).toEqual([["amount", "$350"]]);
  });
  it.each(["due on receipt", "net30", "net 45", "due in 15 days", "due within 2 weeks"])("recognizes term %j", (term) => {
    expect(kinds(`bill a@b.co $5 for x ${term}`).find(([k]) => k === "term")?.[1]).toBe(term);
  });
});
