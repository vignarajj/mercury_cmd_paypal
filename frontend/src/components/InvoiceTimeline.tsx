import { motion } from "motion/react";
import { Check } from "lucide-react";
import { isPaid } from "./StatusPill";

const STEPS = ["Created", "Sent", "Paid"] as const;
const stepOf = (s: string) => (isPaid(s) ? 2 : s === "DRAFT" ? 0 : 1);

export default function InvoiceTimeline({ status, className = "mt-4" }: { status: string; className?: string }) {
  const at = stepOf(status);
  const paid = isPaid(status);
  return (
    <ol className={`${className} flex items-center`} aria-label="Invoice progress">
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

