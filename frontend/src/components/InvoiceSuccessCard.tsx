import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, Copy, ExternalLink, Plus } from "lucide-react";
import { api } from "../lib/api";
import { FINAL_STATUSES, formatMoney } from "../lib/invoice";
import { openExternal } from "../lib/tauri";
import type { InvoiceResult } from "../lib/types";
import StatusPill, { isPaid } from "./StatusPill";

const POLL_MS = 4000;
const POLL_MAX_MS = 5 * 60_000;

/** Poll the invoice every 4 s until it reaches a final state or 5 minutes pass. */
function useInvoiceStatus(invoiceId: string, initial: string) {
  const [status, setStatus] = useState(initial);
  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped || Date.now() - started > POLL_MAX_MS) return;
      try {
        const s = await api.status(invoiceId);
        if (!stopped) setStatus(s.status);
        if (FINAL_STATUSES.has(s.status)) return;
      } catch { /* transient: keep polling */ }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [invoiceId]);
  return status;
}

const STEPS = ["Created", "Sent", "Paid"] as const;
const stepOf = (s: string) => (isPaid(s) ? 2 : s === "DRAFT" ? 0 : 1);

function Timeline({ status }: { status: string }) {
  const at = stepOf(status);
  const paid = isPaid(status);
  return (
    <ol className="mt-4 flex items-center" aria-label="Invoice progress">
      {STEPS.map((label, i) => {
        const done = i < at || paid;
        const current = i === at && !paid;
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none" aria-current={current ? "step" : undefined}>
            <span className={`flex items-center gap-1.5 text-[12.5px] ${done ? "text-ink" : current ? "font-medium text-accent" : "text-ink-faint"}`}>
              <span className={`grid size-[18px] place-items-center rounded-full border text-[10px] ${done ? "border-ok bg-ok text-accent-ink" : current ? "border-accent" : "border-line"}`}>
                {done ? <Check size={11} strokeWidth={3} aria-hidden /> : current ? <motion.span className="size-2 rounded-full bg-accent" animate={{ opacity: [1, 0.35, 1] }} transition={{ repeat: Infinity, duration: 1.6 }} /> : null}
              </span>
              {label}
            </span>
            {i < STEPS.length - 1 && <span aria-hidden className={`mx-3 h-px flex-1 ${i < at || paid ? "bg-ok" : "bg-line"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

function AnimatedCheck() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.12, ease: "easeOut" }} />
    </svg>
  );
}

interface Props { result: InvoiceResult; copied: boolean; onCopy: () => void; onAnother: () => void; onStatus: (id: string, status: string) => void }

export default function InvoiceSuccessCard({ result, copied, onCopy, onAnother, onStatus }: Props) {
  const status = useInvoiceStatus(result.invoice_id, result.status);
  const paid = isPaid(status);
  const total = formatMoney(Math.round(Number(result.total) * 100), result.currency);

  useEffect(() => { onStatus(result.invoice_id, status); }, [result.invoice_id, status, onStatus]);

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
      className="border-t border-line px-4 pb-4 pt-4" aria-label={paid ? "Payment received" : "Invoice sent"}>
      <div className="flex items-start gap-3.5">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 18 }}
          className={`grid size-11 shrink-0 place-items-center rounded-full ${paid ? "bg-ok text-accent-ink" : "bg-ok/15 text-ok"} transition-colors duration-500`}>
          <AnimatedCheck />
        </motion.div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold tracking-tight">{paid ? "Payment received" : `Invoice sent to ${result.client_email}`}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[13px] text-ink-dim">
            <span className="text-[15px] font-medium tabular-nums text-ink">{total}</span>
            {paid && <span className="truncate">from {result.client_email}</span>}
            <span className="font-mono text-[12px] text-ink-faint">{result.invoice_id}</span>
          </p>
        </div>
        <StatusPill status={status} live />
      </div>

      <Timeline status={status} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onCopy}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-accent-ink transition hover:brightness-110 active:scale-[0.98]">
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}{copied ? "Link copied" : "Copy payment link"}
          <span className="rounded-md bg-accent-ink/15 px-1.5 py-0.5 text-[11px] font-medium opacity-80">⌘C</span>
        </button>
        <button type="button" onClick={() => void openExternal(result.invoice_url)}
          className="flex items-center gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[14px] font-medium transition hover:bg-line"><ExternalLink size={15} aria-hidden />Open</button>
        <button type="button" onClick={onAnother}
          className="ml-auto flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-ink-dim transition hover:bg-surface-2 hover:text-ink"><Plus size={14} aria-hidden />Create another</button>
      </div>
    </motion.section>
  );
}
