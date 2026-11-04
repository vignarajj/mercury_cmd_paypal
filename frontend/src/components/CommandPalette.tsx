import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { AlertTriangle, Check, CornerDownLeft, Loader2, Monitor, Moon, Sun, X } from "lucide-react";
import { usePalette, type State } from "../hooks/usePalette";
import { useRecents } from "../hooks/useRecents";
import { useTheme } from "../hooks/useTheme";
import { copyText, hideWindow, isTauri, onPaletteShown, setWindowHeight } from "../lib/tauri";
import EmptyState from "./EmptyState";
import HighlightedInput from "./HighlightedInput";
import InvoicePreviewCard from "./InvoicePreviewCard";
import InvoiceSuccessCard from "./InvoiceSuccessCard";

const STALE_MS = 60_000;
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const THEME_NEXT = { system: "light", light: "dark", dark: "system" } as const;

export default function CommandPalette({ initial }: { initial?: Partial<State> } = {}) {
  const p = usePalette(initial);
  const { state } = p;
  const theme = useTheme();
  const recents = useRecents();
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

  // A sent invoice joins the recents list.
  useEffect(() => { if (state.result) recents.add(state.result); }, [state.result, recents.add]);

  // Hotkey show: refocus, refresh statuses, drop an abandoned draft after 60 s hidden (never a sent invoice).
  useEffect(() => {
    input.current?.focus();
    void recents.refresh();
    const onBlur = () => { hiddenAt.current = Date.now(); };
    const onFocus = () => void recents.refresh();
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    let unlisten = () => {};
    void onPaletteShown(() => {
      const { phase } = stateRef.current;
      if (hiddenAt.current && Date.now() - hiddenAt.current > STALE_MS && (phase === "idle" || phase === "preview")) p.reset();
      input.current?.focus();
      void recents.refresh();
    }).then((f) => { unlisten = f; });
    return () => { window.removeEventListener("blur", onBlur); window.removeEventListener("focus", onFocus); unlisten(); };
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
  const showEmpty = state.phase === "idle" && !state.text.trim() && !state.error;
  const ThemeIcon = THEME_ICON[theme.mode];

  return (
    <MotionConfig reducedMotion="user">
      <main ref={root} aria-label="Mercury Cmd" className="glass w-full max-w-[680px]">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="grid size-7 shrink-0 place-items-center" aria-hidden>
            {busy ? <Loader2 size={22} className="animate-spin text-accent" />
              : state.phase === "success" ? <Check size={22} className="text-ok" />
              : <img src="/mercury.svg" alt="" className="size-7 drop-shadow-sm" draggable={false} />}
          </span>
          <HighlightedInput
            ref={input} autoFocus spellCheck={false} autoComplete="off" autoCapitalize="off"
            value={state.text} disabled={state.phase === "sending"}
            onChange={(e) => p.setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); void p.parse(state.text); }
              if (e.key === "ArrowDown" && showEmpty) { e.preventDefault(); document.querySelector<HTMLElement>("[data-nav]")?.focus(); }
            }}
            placeholder="Describe an invoice, e.g. Bill client@acme.co $500 for logo design, net 15"
            aria-label="Describe the invoice"
          />
          {state.text && state.phase !== "sending" && (
            <button type="button" aria-label="Clear" onClick={() => { p.back(); p.setText(""); input.current?.focus(); }}
              className="grid size-6 shrink-0 place-items-center rounded-md text-ink-faint transition hover:bg-surface-2 hover:text-ink"><X size={15} /></button>
          )}
        </div>

        {state.phase === "parsing" && (
          <div className="space-y-2 border-t border-line px-4 pb-4 pt-3.5" role="status" aria-label="Reading your request">
            <div className="shimmer h-4 w-1/3 rounded" /><div className="shimmer h-10 rounded-lg" /><div className="shimmer h-10 rounded-lg" />
          </div>
        )}

        {showEmpty && (
          <EmptyState recents={recents.recents}
            onExample={(t) => { p.setText(t); void p.parse(t); input.current?.focus(); }}
            onLeaveUp={() => input.current?.focus()} />
        )}

        <AnimatePresence mode="wait" initial={false}>
          {showCard && state.draft && (
            <InvoicePreviewCard key="preview" draft={state.draft} source={state.source} warnings={state.warnings}
              showErrors={state.showErrors} sending={state.phase === "sending"} retryMode={!!state.failedInvoiceId}
              onChange={p.edit} onSend={() => void p.send()} />
          )}
          {state.phase === "success" && state.result && (
            <InvoiceSuccessCard key="success" result={state.result} copied={copied} onCopy={() => void copyLink()}
              onAnother={() => { p.reset(); input.current?.focus(); }} onStatus={recents.setStatus} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {state.error && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              role="alert" className="overflow-hidden border-t border-line">
              <div className="flex items-start gap-2 bg-bad/10 px-4 py-2.5 text-[13px] text-bad">
                <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
                <span className="flex-1">{state.error.message}</span>
                <button type="button" aria-label="Dismiss" onClick={() => p.dispatch({ type: "dismissError" })} className="text-bad/80 hover:text-bad"><X size={14} /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="flex items-center justify-between border-t border-line px-4 py-2 text-[12px] text-ink-faint">
          <span className="flex items-center gap-3.5">
            {state.phase === "success" ? (<><Hint k="⌘C" t="copy link" /><Hint k="esc" t="done" /></>)
              : showCard ? (<><Hint k="⌘↵" t="send" /><Hint k="tab" t="next field" /><Hint k="esc" t="back" /></>)
              : showEmpty ? (<><Hint k="↵" t="read" icon /><Hint k="↓" t="examples" /><Hint k="esc" t="close" /></>)
              : (<><Hint k="↵" t="read" icon /><Hint k="esc" t={state.text ? "clear" : "close"} /></>)}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" onClick={theme.cycle} title={`Theme: ${theme.mode}. Click for ${THEME_NEXT[theme.mode]}.`} aria-label={`Theme: ${theme.mode}. Switch to ${THEME_NEXT[theme.mode]}`}
              className="grid size-6 place-items-center rounded-md text-ink-dim transition hover:bg-surface-2 hover:text-ink"><ThemeIcon size={14} aria-hidden /></button>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tracking-wider text-ink-dim" title="No real money moves. All PayPal calls use the sandbox.">SANDBOX</span>
          </span>
        </footer>
      </main>
    </MotionConfig>
  );
}

function Hint({ k, t, icon }: { k: string; t: string; icon?: boolean }) {
  return <span className="flex items-center gap-1.5"><span className="kbd">{icon ? <CornerDownLeft size={10} className="inline" aria-hidden /> : k}</span>{t}</span>;
}
