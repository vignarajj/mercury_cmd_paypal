import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, Copy, ExternalLink, Loader2, Plus } from "lucide-react";
import { api } from "../lib/api";
import { FINAL_STATUSES, formatMoney } from "../lib/invoice";
import { openExternal } from "../lib/tauri";
import type { InvoiceResult } from "../lib/types";

const POLL_MS = 4000;
const POLL_MAX_MS = 5 * 60_000;

const PILL: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-white/10 text-white/70" },
  SCHEDULED: { label: "Scheduled", cls: "bg-warn/15 text-warn" },
  SENT: { label: "Sent · awaiting payment", cls: "bg-accent/15 text-accent" },
  UNPAID: { label: "Sent · awaiting payment", cls: "bg-accent/15 text-accent" },
  VIEWED: { label: "Viewed by client", cls: "bg-accent/15 text-accent" },
  PAYMENT_PENDING: { label: "Payment pending", cls: "bg-warn/15 text-warn" },
  PARTIALLY_PAID: { label: "Partially paid", cls: "bg-warn/15 text-warn" },
  PAID: { label: "Paid", cls: "bg-ok/15 text-ok" },
  MARKED_AS_PAID: { label: "Paid", cls: "bg-ok/15 text-ok" },
  CANCELLED: { label: "Cancelled", cls: "bg-white/10 text-white/60" },
  REFUNDED: { label: "Refunded", cls: "bg-white/10 text-white/60" },
};

/** Poll the invoice every 4 s until it reaches a final state or 5 minutes pass. */
function useInvoiceStatus(invoiceId: string, initial: string) {
  const [status, setStatus] = useState(initial);
  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped || Date.now() - started > POLL_MAX_MS) return;
      try {
        const s = await api.status(invoiceId);
        if (!stopped) setStatus(s.status);
        if (FINAL_STATUSES.has(s.status)) return;
      } catch { /* transient: keep polling */ }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [invoiceId]);
  return status;
}

interface Props { result: InvoiceResult; copied: boolean; onCopy: () => void; onAnother: () => void }

export default function InvoiceSuccessCard({ result, copied, onCopy, onAnother }: Props) {
  const status = useInvoiceStatus(result.invoice_id, result.status);
  const pill = PILL[status] ?? { label: status, cls: "bg-white/10 text-white/70" };
  const paid = status === "PAID" || status === "MARKED_AS_PAID";
  const total = formatMoney(Math.round(Number(result.total) * 100), result.currency);

  return (
    <motion.section initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
      className="border-t border-white/10 px-4 pb-4 pt-4" aria-label="Invoice sent">
      <div className="flex items-start gap-3">
        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 18 }}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-ok/15 text-ok"><Check size={24} strokeWidth={3} /></motion.div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold">Invoice sent to {result.client_email}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-white/60">
            <span className="tabular-nums text-white/85">{total}</span>
            <span className="font-mono text-[12px]">{result.invoice_id}</span>
          </p>
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${pill.cls}`} aria-live="polite">
          {!paid && !["CANCELLED", "REFUNDED"].includes(status) && <Loader2 size={12} className="animate-spin" />}
          {paid && <Check size={12} />}{pill.label}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onCopy}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-black shadow-lg shadow-accent/20 hover:brightness-110">
          {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Link copied" : "Copy payment link"}<span className="kbd !bg-black/15 !text-black/70">⌘C</span>
        </button>
        <button type="button" onClick={() => void openExternal(result.invoice_url)}
          className="flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-[14px] hover:bg-white/15"><ExternalLink size={15} />Open</button>
        <button type="button" onClick={onAnother}
          className="ml-auto flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] text-white/65 hover:bg-white/10 hover:text-white"><Plus size={14} />Create another</button>
      </div>
    </motion.section>
  );
}
