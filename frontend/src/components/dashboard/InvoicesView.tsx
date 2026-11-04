import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, RefreshCw, Search, ServerOff } from "lucide-react";
import { useRequest } from "../../hooks/useRequest";
import { api } from "../../lib/api";
import { FILTERS, PAGE_SIZE, fmtShortDate, invoiceQueryString, pageRange, type InvoiceQuery } from "../../lib/format";
import { formatMoney } from "../../lib/invoice";
import StatusPill from "../StatusPill";
import InvoiceDetailPanel from "./InvoiceDetailPanel";

export default function InvoicesView() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  // Wait for a pause in typing before asking PayPal.
  useEffect(() => { const t = setTimeout(() => { setQ(text); setPage(1); }, 300); return () => clearTimeout(t); }, [text]);

  const statuses = FILTERS.find((f) => f.id === filter)!.statuses as unknown as string[];
  const query: InvoiceQuery = { page, pageSize: PAGE_SIZE, statuses, q };
  const { data, loading, error, backendDown, reload } = useRequest((signal) => api.invoices(query, signal), invoiceQueryString(query));

  // Open the newest invoice by default; keep the selection if it is still on the page.
  const firstId = data?.items[0]?.invoice_id ?? null;
  useEffect(() => {
    if (!data) return;
    if (!selected || !data.items.some((i) => i.invoice_id === selected)) setSelected(firstId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const listRef = useRef<HTMLUListElement>(null);
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("button[data-row]") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  const items = data?.items ?? [];
  return (
    <div className="flex h-full min-h-0 gap-4 p-5">
      <section aria-label="Invoices" className="glass flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <label className="relative flex-1">
            <span className="sr-only">Search invoices by client email or number</span>
            <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="field pl-9" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by email or number" />
          </label>
          <button type="button" onClick={reload} aria-label="Refresh" title="Refresh from PayPal"
            className="grid size-9 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 hover:text-ink">
            <RefreshCw size={15} aria-hidden className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setPage(1); }}
              className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition ${filter === f.id ? "bg-accent text-accent-ink" : "bg-surface text-ink-dim hover:bg-surface-2 hover:text-ink"}`}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {error && !data && (
            <div role="alert" className="m-4 rounded-xl bg-bad/10 p-4 text-[13.5px] text-bad">
              <div className="flex items-start gap-2">{backendDown ? <ServerOff size={16} aria-hidden className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />}<span>{error}</span></div>
              <button type="button" onClick={reload} className="mt-3 rounded-lg bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-line">Try again</button>
            </div>
          )}
          {!error && loading && !data && (
            <div className="space-y-2 p-4" role="status" aria-label="Loading invoices">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="shimmer h-14 rounded-xl" />)}</div>
          )}
          {data && items.length === 0 && (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div>
                <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-surface-2 text-ink-dim"><Inbox size={22} aria-hidden /></div>
                <p className="text-[15px] font-medium">{q || filter !== "all" ? "No invoices match" : "No invoices yet"}</p>
                <p className="mt-1 text-[13px] text-ink-faint">{q || filter !== "all" ? "Try another filter or search." : "Open the palette and describe your first invoice."}</p>
              </div>
            </div>
          )}
          {items.length > 0 && (
            <ul ref={listRef} onKeyDown={onListKey} className="p-2" aria-label="Invoice list" aria-busy={loading}>
              {items.map((i) => (
                <li key={i.invoice_id}>
                  <button type="button" data-row aria-current={selected === i.invoice_id ? "true" : undefined} onClick={() => setSelected(i.invoice_id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${selected === i.invoice_id ? "bg-accent/12 ring-1 ring-accent/40" : "hover:bg-surface"}`}>
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#009cde] to-[#003087] text-[13px] font-semibold uppercase text-white">{i.client_email.slice(0, 1) || "?"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-ink">{i.client_email || "Unknown recipient"}</span>
                      <span className="block truncate text-[12.5px] text-ink-faint">Invoice {i.number ?? "–"} · {fmtShortDate(i.created_at)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[14px] font-semibold tabular-nums">{formatMoney(Math.round(Number(i.total) * 100), i.currency)}</span>
                      <StatusPill status={i.status} compact />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {data && data.total_items > 0 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12.5px] text-ink-faint">
            <span aria-live="polite">{pageRange(data.page, data.page_size, data.total_items, items.length)}</span>
            <span className="flex items-center gap-1">
              <button type="button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}
                className="grid size-7 place-items-center rounded-md transition hover:bg-surface-2 hover:text-ink disabled:opacity-35"><ChevronLeft size={15} aria-hidden /></button>
              <button type="button" aria-label="Next page" disabled={page >= data.total_pages || loading} onClick={() => setPage((p) => p + 1)}
                className="grid size-7 place-items-center rounded-md transition hover:bg-surface-2 hover:text-ink disabled:opacity-35"><ChevronRight size={15} aria-hidden /></button>
            </span>
          </div>
        )}
      </section>

      <aside aria-label="Invoice details" className="glass w-[390px] shrink-0 overflow-auto"><InvoiceDetailPanel invoiceId={selected} /></aside>
    </div>
  );
}
