import { useEffect, useRef } from "react";
import { motion, type Variants } from "motion/react";
import { AlertTriangle, CalendarClock, Coins, FileText, Mail, Plus, RotateCcw, Send, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useCountUp } from "../hooks/useCountUp";
import { CURRENCIES, MAX_ITEMS, dueOptions, formatMoney, lineCents, totalCents, validate, type Draft } from "../lib/invoice";
import SelectField from "./SelectField";
import SendProgress from "./SendProgress";

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CAD: "$", AUD: "$" };
const COLS = "grid-cols-[minmax(0,1fr)_52px_104px_84px_28px]";

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } }, exit: { opacity: 0, transition: { duration: 0.12 } } };
const item: Variants = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: "easeOut" } } };

interface Props {
  draft: Draft;
  source: "llm" | "regex" | null;
  warnings: string[];
  showErrors: boolean;
  sending: boolean;
  retryMode: boolean; // a draft already exists at PayPal; only the send can be retried
  onChange: (d: Draft) => void;
  onSend: () => void;
}

export default function InvoicePreviewCard({ draft, source, warnings, showErrors, sending, retryMode, onChange, onSend }: Props) {
  const emailRef = useRef<HTMLInputElement>(null);
  const errors = validate(draft);
  const err = (k: string) => (showErrors ? errors[k] : undefined);
  const locked = sending || retryMode;
  const cents = totalCents(draft);
  const shown = useCountUp(cents);
  const emailMissing = !draft.client_email.trim();

  useEffect(() => {
    if (!draft.client_email.trim()) emailRef.current?.focus(); // jump straight to the missing field
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setItem = (n: number, patch: Partial<Draft["items"][number]>) =>
    onChange({ ...draft, items: draft.items.map((it, i) => (i === n ? { ...it, ...patch } : it)) });

  return (
    <motion.section variants={container} initial="hidden" animate="show" exit="exit" className="border-t border-line px-4 pb-4 pt-3.5" aria-label="Invoice preview">
      <motion.div variants={item} className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint"><FileText size={13} aria-hidden />Invoice preview</h2>
        {source === "llm" ? (
          <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[12px] font-medium text-accent" title="Read by the local AI model and checked against your text"><Sparkles size={12} aria-hidden />AI</span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-medium text-ink-dim" title="Ollama was unavailable or found nothing; the rule-based parser answered"><Wand2 size={12} aria-hidden />Basic mode</span>
        )}
      </motion.div>

      <motion.div variants={item}>
        <label htmlFor="bill-to" className="mb-1 flex items-center gap-2 text-[12px] font-medium text-ink-dim">
          Bill to
          {emailMissing && (
            <button type="button" onClick={() => emailRef.current?.focus()} className="flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[11.5px] text-warn">
              <AlertTriangle size={11} aria-hidden />Missing: email. Click to type
            </button>
          )}
        </label>
        <div className="relative mb-3.5">
          <Mail size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input id="bill-to" ref={emailRef} className="field pl-9" type="email" value={draft.client_email} disabled={locked}
            placeholder="client@company.com" aria-invalid={!!err("client_email") || emailMissing} aria-describedby={err("client_email") ? "bill-to-err" : undefined}
            onChange={(e) => onChange({ ...draft, client_email: e.target.value })} />
        </div>
        {err("client_email") && !emailMissing && <p id="bill-to-err" className="-mt-2.5 mb-2.5 text-[12px] text-warn">{err("client_email")}</p>}
      </motion.div>

      <motion.div variants={item} className="rounded-xl border border-line bg-surface/60 p-2.5">
        <div className={`mb-1.5 grid ${COLS} gap-2 px-0.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-faint`}>
          <span>Description</span><span className="text-center">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span><span />
        </div>
        <div className="space-y-1.5">
          {draft.items.map((it, n) => {
            const line = lineCents(it);
            return (
              <div key={n} className={`grid ${COLS} items-center gap-2`}>
                <input className="field" value={it.name} disabled={locked} placeholder="What for?" aria-label={`Item ${n + 1} description`}
                  aria-invalid={!!err(`items.${n}.name`)} onChange={(e) => setItem(n, { name: e.target.value })} />
                <input className="field px-1 text-center tabular-nums" inputMode="numeric" value={it.quantity} disabled={locked} aria-label={`Item ${n + 1} quantity`}
                  aria-invalid={!!err(`items.${n}.quantity`)} onChange={(e) => setItem(n, { quantity: e.target.value })} />
                <div className="relative">
                  <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint">{SYMBOL[draft.currency]}</span>
                  <input className="field pl-6 text-right tabular-nums" inputMode="decimal" value={it.unit_amount} disabled={locked} aria-label={`Item ${n + 1} unit price`}
                    aria-invalid={!!err(`items.${n}.unit_amount`)} onChange={(e) => setItem(n, { unit_amount: e.target.value })} />
                </div>
                <span className="text-right text-[13.5px] tabular-nums text-ink-dim" aria-label={`Item ${n + 1} amount`}>{line === null ? "–" : formatMoney(line, draft.currency)}</span>
                <button type="button" aria-label={`Remove item ${n + 1}`} disabled={locked || draft.items.length === 1}
                  className="grid size-7 place-items-center rounded-md text-ink-faint transition hover:bg-surface-2 hover:text-ink disabled:opacity-30"
                  onClick={() => onChange({ ...draft, items: draft.items.filter((_, i) => i !== n) })}><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
        {draft.items.length === 0 && (
          <button type="button" disabled={locked} onClick={() => onChange({ ...draft, items: [{ name: "", quantity: "1", unit_amount: "" }] })}
            className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-warn/60 px-3 py-2 text-[13px] text-warn">
            <AlertTriangle size={13} aria-hidden />Missing: amount. Click to add an item
          </button>
        )}
        {draft.items.length > 0 && draft.items.length < MAX_ITEMS && (
          <button type="button" disabled={locked} className="mt-2 flex items-center gap-1 rounded-md px-1 py-0.5 text-[12.5px] font-medium text-accent transition hover:bg-accent/10 disabled:opacity-40"
            onClick={() => onChange({ ...draft, items: [...draft.items, { name: "", quantity: "1", unit_amount: "" }] })}><Plus size={13} aria-hidden />Add item</button>
        )}
      </motion.div>

      <motion.div variants={item} className="mt-3.5 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <SelectField label="Currency" icon={Coins} value={draft.currency} disabled={locked} onChange={(v) => onChange({ ...draft, currency: v })}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </SelectField>
          <SelectField label="Payment terms" icon={CalendarClock} value={draft.due_days ?? ""} disabled={locked}
            onChange={(v) => onChange({ ...draft, due_days: v === "" ? null : Number(v) })}>
            {dueOptions(draft.due_days).map((o) => <option key={o.label} value={o.value ?? ""}>{o.label}</option>)}
          </SelectField>
        </div>
        <div className="text-right" aria-live="polite">
          <div className="text-[11.5px] font-medium uppercase tracking-wide text-ink-faint">Total due</div>
          <div className="text-[26px] font-semibold leading-8 tracking-tight tabular-nums">{formatMoney(shown, draft.currency)}</div>
        </div>
      </motion.div>

      {warnings.length > 0 && (
        <motion.ul variants={item} className="mt-3 space-y-1">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 rounded-lg bg-warn/12 px-2.5 py-1.5 text-[12.5px] text-warn"><AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" />{w}</li>
          ))}
        </motion.ul>
      )}

      <motion.div variants={item} className="mt-4 flex items-center justify-between gap-3">
        {sending ? <SendProgress /> : <span className="text-[12.5px] text-ink-faint">{retryMode ? "Draft saved at PayPal. Retry the send." : "Check the details, edit anything, then send."}</span>}
        <button type="button" onClick={onSend} disabled={sending}
          className="flex items-center gap-2 rounded-xl bg-cta px-4 py-2.5 text-[14px] font-semibold text-cta-ink shadow-[0_10px_26px_-10px_var(--cta)] transition hover:brightness-105 active:scale-[0.98] disabled:opacity-55">
          {retryMode ? <RotateCcw size={15} aria-hidden /> : <Send size={15} aria-hidden />}
          {retryMode ? "Retry send" : "Send via PayPal"}
          <span className="rounded-md bg-cta-ink/12 px-1.5 py-0.5 text-[11px] font-medium text-cta-ink/80">⌘↵</span>
        </button>
      </motion.div>
    </motion.section>
  );
}
