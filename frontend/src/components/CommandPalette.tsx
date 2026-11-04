import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, CornerDownLeft, Loader2, Sparkles, X } from "lucide-react";
import { usePalette } from "../hooks/usePalette";
import { copyText, hideWindow, isTauri, onPaletteShown, setWindowHeight } from "../lib/tauri";
import InvoicePreviewCard from "./InvoicePreviewCard";
import InvoiceSuccessCard from "./InvoiceSuccessCard";

const STALE_MS = 60_000;

export default function CommandPalette() {
  const p = usePalette();
  const { state } = p;
  const stateRef = useRef(state);
  stateRef.current = state;
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const hiddenAt = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);

  const copyLink = useCallback(async () => {
    const url = stateRef.current.result?.invoice_url;
    if (url && (await copyText(url))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }, []);

  // Two-stage Escape (spec section 7): preview -> back to input -> clear text -> hide.
  const escape = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === "sending") return;
    if (s.phase === "success") { p.reset(); void hideWindow(); return; }
    if (s.phase === "preview" || s.phase === "parsing") { p.back(); input.current?.focus(); return; }
    if (s.text) { p.setText(""); return; }
    void hideWindow();
  }, [p]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") { e.preventDefault(); escape(); }
      else if (mod && e.key === "Enter") { e.preventDefault(); void p.send(); }
      else if (mod && e.key.toLowerCase() === "c" && stateRef.current.phase === "success" && !window.getSelection()?.toString()) { e.preventDefault(); void copyLink(); }
      else if (mod && e.key.toLowerCase() === "k" && !isTauri) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escape, copyLink, p]);

  // Hotkey show: refocus the input; drop an abandoned draft after 60 s hidden (never a sent invoice).
  useEffect(() => {
    input.current?.focus();
    const onBlur = () => { hiddenAt.current = Date.now(); };
    window.addEventListener("blur", onBlur);
    let unlisten = () => {};
    void onPaletteShown(() => {
      const { phase } = stateRef.current;
      if (hiddenAt.current && Date.now() - hiddenAt.current > STALE_MS && (phase === "idle" || phase === "preview")) p.reset();
      input.current?.focus();
    }).then((f) => { unlisten = f; });
    return () => { window.removeEventListener("blur", onBlur); unlisten(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native window follows the content height (desktop only; no-op in web mode).
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => void setWindowHeight(Math.max(Math.ceil(el.getBoundingClientRect().height), 72)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const busy = state.phase === "parsing" || state.phase === "sending";
  const showCard = state.phase === "preview" || state.phase === "sending";

  return (
    <div ref={root} className="glass w-full max-w-[680px]">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="grid size-6 place-items-center text-white/60" aria-hidden>
          {busy ? <Loader2 size={20} className="animate-spin text-accent" /> : state.phase === "success" ? <Check size={20} className="text-ok" /> : <Sparkles size={20} />}
        </span>
        <input
          ref={input} autoFocus spellCheck={false} autoComplete="off"
          value={state.text} disabled={state.phase === "sending"}
          onChange={(e) => p.setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); void p.parse(state.text); } }}
          placeholder="Try: Bill client@acme.co $500 for logo design, net 15"
          aria-label="Describe the invoice"
          className="min-w-0 flex-1 bg-transparent text-[18px] outline-none placeholder:text-white/35"
        />
        {state.text && state.phase !== "sending" && (
          <button type="button" aria-label="Clear" onClick={() => { p.back(); p.setText(""); input.current?.focus(); }}
            className="grid size-6 place-items-center rounded-md text-white/40 hover:bg-white/10 hover:text-white"><X size={15} /></button>
        )}
      </div>

      {state.phase === "parsing" && (
        <div className="space-y-2 border-t border-white/10 px-4 pb-4 pt-3" aria-label="Reading your request">
          <div className="shimmer h-4 w-1/3 rounded" /><div className="shimmer h-9 rounded-lg" /><div className="shimmer h-9 rounded-lg" />
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {showCard && state.draft && (
          <InvoicePreviewCard key="preview" draft={state.draft} source={state.source} warnings={state.warnings}
            showErrors={state.showErrors} sending={state.phase === "sending"} retryMode={!!state.failedInvoiceId}
            onChange={p.edit} onSend={() => void p.send()} />
        )}
        {state.phase === "success" && state.result && (
          <InvoiceSuccessCard key="success" result={state.result} copied={copied} onCopy={() => void copyLink()}
            onAnother={() => { p.reset(); input.current?.focus(); }} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {state.error && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            role="alert" className="overflow-hidden border-t border-white/10">
            <div className="flex items-start gap-2 bg-bad/10 px-4 py-2.5 text-[13px] text-bad">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span className="flex-1">{state.error.message}</span>
              <button type="button" aria-label="Dismiss" onClick={() => p.dispatch({ type: "dismissError" })} className="text-bad/70 hover:text-bad"><X size={14} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[11.5px] text-white/45">
        <span className="flex items-center gap-3">
          {state.phase === "success" ? (<><Hint k="⌘C" t="copy link" /><Hint k="esc" t="done" /></>)
            : showCard ? (<><Hint k="⌘↵" t="send" /><Hint k="tab" t="next field" /><Hint k="esc" t="back" /></>)
            : (<><Hint k="↵" t="read" icon /><Hint k="esc" t={state.text ? "clear" : "close"} /></>)}
        </span>
        <span className="rounded-full bg-white/8 px-2 py-0.5 tracking-wide text-white/55" title="No real money moves. All PayPal calls use the sandbox.">SANDBOX</span>
      </footer>
    </div>
  );
}

function Hint({ k, t, icon }: { k: string; t: string; icon?: boolean }) {
  return <span className="flex items-center gap-1.5"><span className="kbd">{icon ? <CornerDownLeft size={10} className="inline" /> : k}</span>{t}</span>;
}
