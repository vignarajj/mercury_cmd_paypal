import { useState } from "react";
import { AlertTriangle, Check, Copy, ExternalLink, FileText } from "lucide-react";
import { useRequest } from "../../hooks/useRequest";
import { api } from "../../lib/api";
import { fmtDate, fmtDateTime, termLabel } from "../../lib/format";
import { formatMoney } from "../../lib/invoice";
import { copyText, openExternal } from "../../lib/tauri";
import InvoiceTimeline from "../InvoiceTimeline";
import StatusPill, { isPaid } from "../StatusPill";

const cents = (v: string | null | undefined) => Math.round(Number(v ?? 0) * 100);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-4">
      <h3 className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, strong = false }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-[14px]">
      <dt className="text-ink-dim">{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? "font-semibold text-ink" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

export default function InvoiceDetailPanel({ invoiceId }: { invoiceId: string | null }) {
  const { data: d, loading, error, reload } = useRequest(invoiceId ? (signal) => api.invoiceDetail(invoiceId, signal) : null, invoiceId ?? "none");
  const [copied, setCopied] = useState<"link" | "id" | null>(null);

  const copy = async (what: "link" | "id", text: string) => {
    if (await copyText(text)) { setCopied(what); setTimeout(() => setCopied(null), 1500); }
  };

  if (!invoiceId) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-surface-2 text-ink-dim"><FileText size={22} aria-hidden /></div>
          <p className="text-[15px] font-medium">Select an invoice</p>
          <p className="mt-1 text-[13px] text-ink-faint">Its items, dates and payments appear here.</p>
        </div>
      </div>
    );
  }
  if (error && !d) {
    return (
      <div role="alert" className="p-5">
        <div className="flex items-start gap-2 rounded-xl bg-bad/10 p-3 text-[13px] text-bad"><AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" /><span className="flex-1">{error}</span></div>
        <button type="button" onClick={reload} className="mt-3 rounded-lg bg-surface-2 px-3 py-1.5 text-[13px] font-medium hover:bg-line">Try again</button>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="space-y-3 p-5" role="status" aria-label="Loading invoice">
        <div className="shimmer h-5 w-2/3 rounded" /><div className="shimmer h-9 w-1/3 rounded" /><div className="shimmer h-24 rounded-lg" /><div className="shimmer h-24 rounded-lg" />
      </div>
    );
  }

  const paid = isPaid(d.status);
  const balance = d.due_amount ?? (paid ? "0.00" : d.total);
  return (
    <article aria-label={`Invoice ${d.number ?? d.invoice_id}`} aria-busy={loading}>
      <header className="px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[17px] font-semibold tracking-tight">{d.client_email}</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-faint">Invoice {d.number ?? "–"}</p>
            <p className="truncate font-mono text-[12px] text-ink-faint" title={d.invoice_id}>{d.invoice_id}</p>
          </div>
          <StatusPill status={d.status} />
        </div>
        <p className="mt-3 text-[30px] font-semibold leading-9 tracking-tight tabular-nums">{formatMoney(cents(d.total), d.currency)}</p>
        <InvoiceTimeline status={d.status} className="mt-4" />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void copy("link", d.invoice_url)}
            className="flex items-center gap-2 rounded-xl bg-accent px-3.5 py-2 text-[13.5px] font-semibold text-accent-ink transition hover:brightness-110">
            {copied === "link" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{copied === "link" ? "Link copied" : "Copy payment link"}
          </button>
          <button type="button" onClick={() => void openExternal(d.invoice_url)}
            className="flex items-center gap-2 rounded-xl bg-surface-2 px-3.5 py-2 text-[13.5px] font-medium transition hover:bg-line"><ExternalLink size={14} aria-hidden />Open payer page</button>
          <button type="button" onClick={() => void copy("id", d.invoice_id)}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-ink-dim transition hover:bg-surface-2 hover:text-ink">
            {copied === "id" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{copied === "id" ? "ID copied" : "Copy ID"}
          </button>
        </div>
      </header>

      <Section title="Items">
        {d.items.length === 0 ? <p className="text-[13px] text-ink-faint">No line items.</p> : (
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-[11.5px] uppercase tracking-wide text-ink-faint">
                <th scope="col" className="pb-1.5 font-medium">Description</th><th scope="col" className="pb-1.5 text-center font-medium">Qty</th>
                <th scope="col" className="pb-1.5 text-right font-medium">Unit</th><th scope="col" className="pb-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((it, i) => (
                <tr key={i} className="border-t border-line/60">
                  <td className="py-1.5 pr-2">{it.name}</td>
                  <td className="py-1.5 text-center tabular-nums">{it.quantity}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink-dim">{formatMoney(cents(it.unit_amount), d.currency)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatMoney(cents(it.amount), d.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <dl className="mt-3 border-t border-line pt-2">
          <Row label="Total" value={formatMoney(cents(d.total), d.currency)} strong />
          <Row label="Paid" value={formatMoney(cents(d.paid_amount), d.currency)} />
          <Row label="Balance due" value={formatMoney(cents(balance), d.currency)} strong={!paid} />
        </dl>
      </Section>

      <Section title="Dates and terms">
        <dl>
          <Row label="Invoice date" value={fmtDate(d.invoice_date)} />
          <Row label="Sent" value={fmtDateTime(d.sent_at)} />
          <Row label="Terms" value={termLabel(d.payment_term)} />
          {d.due_date && <Row label="Due" value={fmtDate(d.due_date)} />}
        </dl>
      </Section>

      <Section title="Payments">
        {d.payments.length === 0 ? <p className="text-[13px] text-ink-faint">No payments yet.</p> : (
          <ul className="space-y-2">
            {d.payments.map((p, i) => (
              <li key={p.payment_id ?? i} className="rounded-xl bg-surface p-3 text-[13.5px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium tabular-nums">{formatMoney(cents(p.amount), d.currency)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ${p.status === "SUCCESS" ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>{p.status ?? "Unknown"}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-dim">{fmtDateTime(p.date)} · {p.method ?? "PayPal"}</p>
                {p.payment_id && <p className="mt-0.5 font-mono text-[12px] text-ink-faint">{p.payment_id}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {d.note && <Section title="Note"><p className="text-[14px] text-ink-dim">{d.note}</p></Section>}
    </article>
  );
}
