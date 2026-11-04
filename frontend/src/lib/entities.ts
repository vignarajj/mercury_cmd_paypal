/** Client-side visual cue only: marks what the AI is likely to read. The backend stays the source of truth. */
export type EntityKind = "email" | "amount" | "term" | "currency" | "text";
export interface Segment { text: string; kind: EntityKind }

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const TERM = /\bdue\s+(?:on|upon)\s+receipt\b|\bdue\s+immediately\b|\bnet\s*-?\s*\d{1,3}\b|\bdue\s+(?:in|within)\s+\d{1,3}\s*(?:days?|weeks?|months?)\b/gi;
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const MARKED = new RegExp(
  String.raw`[$€£]\s*${NUM}\s*[kK]?(?![\w])|\b(?:USD|EUR|GBP|CAD|AUD)\s*${NUM}\s*[kK]?(?![\w])|(?<![\w.])${NUM}\s*[kK]?\s*\b(?:USD|EUR|GBP|CAD|AUD)\b`,
  "gi",
);
const BARE = new RegExp(String.raw`(?<![\w.])${NUM}[kK]?\b`, "g");

interface Span { start: number; end: number; kind: EntityKind }

const overlaps = (a: Span, spans: Span[]) => spans.some((b) => a.start < b.end && b.start < a.end);

function* matches(re: RegExp, text: string, kind: EntityKind): Generator<Span> {
  for (const m of text.matchAll(re)) yield { start: m.index!, end: m.index! + m[0].length, kind };
}

const value = (s: string) => {
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  return /k$/i.test(s.trim()) ? n * 1000 : n;
};

export function tokenize(text: string): Segment[] {
  const spans: Span[] = [];
  const add = (s: Span) => { if (!overlaps(s, spans)) spans.push(s); };

  for (const s of matches(EMAIL, text, "email")) add(s);
  for (const s of matches(TERM, text, "term")) add(s);
  const marked = [...matches(MARKED, text, "amount")];
  marked.forEach(add);

  // Mirror the backend: with no marked amount, the largest bare number is the amount.
  if (!marked.length) {
    const bare = [...matches(BARE, text, "amount")].filter((s) => !overlaps(s, spans));
    if (bare.length) add(bare.reduce((a, b) => (value(text.slice(b.start, b.end)) > value(text.slice(a.start, a.end)) ? b : a)));
  }

  spans.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start > at) out.push({ text: text.slice(at, s.start), kind: "text" });
    out.push({ text: text.slice(s.start, s.end), kind: s.kind });
    at = s.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), kind: "text" });
  return out;
}
