import type { InvoiceResult } from "./types";

export interface Recent {
  invoice_id: string;
  client_email: string;
  total: string;
  currency: string;
  status: string;
  url: string;
  ts: number;
}

const KEY = "mercury.recents.v1";
export const MAX_RECENTS = 5;

const isRecent = (x: unknown): x is Recent => {
  const r = x as Recent;
  return !!r && typeof r.invoice_id === "string" && typeof r.client_email === "string" && typeof r.total === "string"
    && typeof r.currency === "string" && typeof r.status === "string" && typeof r.url === "string" && typeof r.ts === "number";
};

export function loadRecents(): Recent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(isRecent).slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export function saveRecents(list: Recent[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable: recents are a convenience only */ }
}

export const addRecent = (list: Recent[], r: InvoiceResult, now = Date.now()): Recent[] =>
  [{ invoice_id: r.invoice_id, client_email: r.client_email, total: r.total, currency: r.currency, status: r.status, url: r.invoice_url, ts: now },
    ...list.filter((x) => x.invoice_id !== r.invoice_id)].slice(0, MAX_RECENTS);

export const setRecentStatus = (list: Recent[], id: string, status: string): Recent[] =>
  list.some((x) => x.invoice_id === id && x.status !== status) ? list.map((x) => (x.invoice_id === id ? { ...x, status } : x)) : list;

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
