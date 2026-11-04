import { motion } from "motion/react";
import { Check, CircleDashed, Clock, Loader2, X } from "lucide-react";

type Tone = "info" | "ok" | "warn" | "muted";
const MAP: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "muted" },
  SCHEDULED: { label: "Scheduled", tone: "warn" },
  SENT: { label: "Awaiting payment", tone: "info" },
  UNPAID: { label: "Awaiting payment", tone: "info" },
  VIEWED: { label: "Viewed", tone: "info" },
  PAYMENT_PENDING: { label: "Payment pending", tone: "warn" },
  PARTIALLY_PAID: { label: "Partially paid", tone: "warn" },
  PAID: { label: "Paid", tone: "ok" },
  MARKED_AS_PAID: { label: "Paid", tone: "ok" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
  REFUNDED: { label: "Refunded", tone: "muted" },
};
const TONE: Record<Tone, string> = {
  info: "bg-accent/15 text-accent",
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  muted: "bg-surface-2 text-ink-dim",
};

export const isPaid = (s: string) => s === "PAID" || s === "MARKED_AS_PAID";

export default function StatusPill({ status, live = false, compact = false }: { status: string; live?: boolean; compact?: boolean }) {
  const { label, tone } = MAP[status] ?? { label: status, tone: "muted" as Tone };
  const Icon = isPaid(status) ? Check : status === "CANCELLED" || status === "REFUNDED" ? X : status === "DRAFT" ? CircleDashed : live && tone !== "ok" ? Loader2 : Clock;
  return (
    <motion.span
      key={status} role="status" aria-label={`Status: ${label}`}
      initial={{ scale: 0.92, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 420, damping: 22 }}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium ${compact ? "px-2 py-0.5 text-[11.5px]" : "px-2.5 py-1 text-[12px]"} ${TONE[tone]} ${isPaid(status) ? "shadow-[0_0_0_4px_color-mix(in_oklab,var(--ok)_18%,transparent)]" : ""}`}
    >
      <Icon size={compact ? 11 : 12} className={Icon === Loader2 ? "animate-spin" : ""} aria-hidden />
      {label}
    </motion.span>
  );
}
