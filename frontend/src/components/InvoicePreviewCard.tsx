import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Plus, Send, Sparkles, Trash2, Wand2, RotateCcw } from "lucide-react";
import { CURRENCIES, MAX_ITEMS, dueOptions, formatMoney, totalCents, validate, type Draft } from "../lib/invoice";
import SendProgress from "./SendProgress";

const SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", CAD: "$", AUD: "$" };

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
  const total = formatMoney(totalCents(draft), draft.currency);
  const emailMissing = !draft.client_email.trim();

  useEffect(() => {
    if (!draft.client_email.trim()) emailRef.current?.focus(); // jump straight to the missing field
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setItem = (n: number, patch: Partial<Draft["items"][number]>) =>
    onChange({ ...draft, items: draft.items.map((it, i) => (i === n ? { ...it, ...patch } : it)) });

  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}
      className="border-t border-white/10 px-4 pb-4 pt-3"
      aria-label="Invoice preview"
    >
      <div className="mb-3 flex items-center justify-between text-[12px] text-white/55">
        <span className="font-medium uppercase tracking-wide">Invoice preview</span>
        {source === "llm" ? (
          <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-accent"><Sparkles size={12} />AI</span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5" title="Ollama unavailable or found nothing; the rule-based parser answered"><Wand2 size={12} />Basic mode</span>
        )}
      </div>

      <label className="mb-1 flex items-center gap-2 text-[12px] text-white/55">
        Bill to
        {emailMissing && (
          <button type="button" onClick={() => emailRef.current?.focus()} className="flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-warn">
            <AlertTriangle size={11} />Missing: email. Click to type
          </button>
        )}
      </label>
      <input ref={emailRef} className="field mb-3" type="email" value={draft.client_email} disabled={locked}
        placeholder="client@company.com" aria-invalid={!!err("client_email") || emailMissing}
        onChange={(e) => onChange({ ...draft, client_email: e.target.value })} />
      {err("client_email") && !emailMissing && <p className="-mt-2 mb-2 text-[12px] text-warn">{err("client_email")}</p>}

      <div className="mb-1 grid grid-cols-[1fr_56px_112px_28px] gap-2 text-[12px] text-white/55">
        <span>Description</span><span>Qty</span><span>Unit price</span><span />
      </div>
      <div className="space-y-2">
        {draft.items.map((it, n) => (
          <div key={n} className="grid grid-cols-[1fr_56px_112px_28px] items-center gap-2">
            <input className="field" value={it.name} disabled={locked} placeholder="What for?" aria-label={`Item ${n + 1} description`}
              aria-invalid={!!err(`items.${n}.name`)} onChange={(e) => setItem(n, { name: e.target.value })} />
            <input className="field text-center" inputMode="numeric" value={it.quantity} disabled={locked} aria-label={`Item ${n + 1} quantity`}
              aria-invalid={!!err(`items.${n}.quantity`)} onChange={(e) => setItem(n, { quantity: e.target.value })} />
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-white/45">{SYMBOL[draft.currency]}</span>
              <input className="field pl-6 text-right" inputMode="decimal" value={it.unit_amount} disabled={locked} aria-label={`Item ${n + 1} unit price`}
                aria-invalid={!!err(`items.${n}.unit_amount`)} onChange={(e) => setItem(n, { unit_amount: e.target.value })} />
            </div>
            <button type="button" aria-label={`Remove item ${n + 1}`} disabled={locked || draft.items.length === 1}
              className="grid size-7 place-items-center rounded-md text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-30"
              onClick={() => onChange({ ...draft, items: draft.items.filter((_, i) => i !== n) })}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      {draft.items.length === 0 && (
        <button type="button" disabled={locked} onClick={() => onChange({ ...draft, items: [{ name: "", quantity: "1", unit_amount: "" }] })}
          className="flex w-full items-center gap-1 rounded-lg border border-dashed border-warn/50 px-3 py-2 text-[13px] text-warn">
          <AlertTriangle size={13} />Missing: amount. Click to add an item
        </button>
      )}
      {draft.items.length > 0 && draft.items.length < MAX_ITEMS && (
        <button type="button" disabled={locked} className="mt-2 flex items-center gap-1 text-[12px] text-white/55 hover:text-white disabled:opacity-40"
          onClick={() => onChange({ ...draft, items: [...draft.items, { name: "", quantity: "1", unit_amount: "" }] })}><Plus size={13} />Add item</button>
      )}

      <div className="mt-3 flex items-center gap-2">
        <select className="field !w-auto" value={draft.currency} disabled={locked} aria-label="Currency" onChange={(e) => onChange({ ...draft, currency: e.target.value })}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="field !w-auto" value={draft.due_days ?? ""} disabled={locked} aria-label="Payment terms"
          onChange={(e) => onChange({ ...draft, due_days: e.target.value === "" ? null : Number(e.target.value) })}>
          {dueOptions(draft.due_days).map((o) => <option key={o.label} value={o.value ?? ""}>{o.label}</option>)}
        </select>
        <div className="ml-auto text-right">
          <div className="text-[11px] uppercase tracking-wide text-white/45">Total</div>
          <div className="text-lg font-semibold tabular-nums">{total}</div>
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 rounded-lg bg-warn/10 px-2.5 py-1.5 text-[12px] text-warn"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        {sending ? <SendProgress /> : <span className="text-[12px] text-white/45">{retryMode ? "Draft saved. Retry the send." : "Review, edit anything, then send."}</span>}
        <button type="button" onClick={onSend} disabled={sending}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-black shadow-lg shadow-accent/20 transition hover:brightness-110 disabled:opacity-50">
          {retryMode ? <RotateCcw size={15} /> : <Send size={15} />}
          {retryMode ? "Retry send" : "Send via PayPal"}
          <span className="kbd !bg-black/15 !text-black/70">⌘↵</span>
        </button>
      </div>
    </motion.section>
  );
}
