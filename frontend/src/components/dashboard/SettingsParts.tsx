import { CircleDot } from "lucide-react";

export type Tone = "ok" | "warn" | "bad";
const TONE_CLASS: Record<Tone, string> = { ok: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn", bad: "bg-bad/15 text-bad" };

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${TONE_CLASS[tone]}`}><CircleDot size={11} aria-hidden />{children}</span>;
}

export function Card({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="glass shrink-0">
      <div className="border-b border-line px-5 py-3.5">
        <h2 id={id} className="text-[15px] font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-faint">{description}</p>}
      </div>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12.5px] text-ink-faint">{hint}</div>}
      </div>
      <div className="shrink-0 text-right text-[13.5px]">{children}</div>
    </div>
  );
}
