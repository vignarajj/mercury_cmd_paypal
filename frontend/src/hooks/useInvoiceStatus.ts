import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { FINAL_STATUSES } from "../lib/invoice";
import { onPaletteShown } from "../lib/tauri";

// A payment can arrive long after the invoice is sent, so poll for an hour: fast at first, then gently.
export const FAST_MS = 4000;
export const SLOW_MS = 15_000;
export const FAST_WINDOW_MS = 2 * 60_000;
export const MAX_MS = 60 * 60_000;

/**
 * Live status of one invoice.
 * - Polls every 4 s for 2 minutes, then every 15 s, for up to an hour; stops at a final status.
 * - Re-checks immediately when the window is focused, shown or becomes visible again, because a
 *   hidden window's timers are throttled and the payment often lands while you are in the browser.
 */
export function useInvoiceStatus(invoiceId: string, initial: string) {
  const [status, setStatus] = useState(initial);
  const latest = useRef(initial);

  useEffect(() => {
    let stopped = false;
    let inflight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const loop = async () => {
      if (stopped || inflight || Date.now() - started > MAX_MS) return;
      inflight = true;
      let done = false;
      try {
        const s = await api.status(invoiceId);
        if (!stopped) { latest.current = s.status; setStatus(s.status); }
        done = FINAL_STATUSES.has(s.status);
      } catch { /* transient: try again on the next tick */ }
      inflight = false;
      if (stopped || done) return;
      timer = setTimeout(loop, Date.now() - started < FAST_WINDOW_MS ? FAST_MS : SLOW_MS);
    };

    const wake = () => {
      if (stopped || FINAL_STATUSES.has(latest.current)) return;
      clearTimeout(timer);
      void loop();
    };
    const onVisible = () => { if (document.visibilityState === "visible") wake(); };

    timer = setTimeout(loop, FAST_MS);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", onVisible);
    let unlisten = () => {};
    void onPaletteShown(wake).then((f) => { unlisten = f; });

    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", onVisible);
      unlisten();
    };
  }, [invoiceId]);

  return status;
}
