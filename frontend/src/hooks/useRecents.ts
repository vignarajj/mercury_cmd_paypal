import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { FINAL_STATUSES } from "../lib/invoice";
import { addRecent, loadRecents, saveRecents, setRecentStatus, type Recent } from "../lib/recents";
import type { InvoiceResult } from "../lib/types";

/** Last few invoices from this device, with statuses refreshed from PayPal whenever the palette opens. */
export function useRecents() {
  const [recents, setRecents] = useState<Recent[]>(loadRecents);
  const ref = useRef(recents);
  ref.current = recents;

  useEffect(() => { saveRecents(recents); }, [recents]);

  const add = useCallback((r: InvoiceResult) => setRecents((l) => addRecent(l, r)), []);
  const setStatus = useCallback((id: string, status: string) => setRecents((l) => setRecentStatus(l, id, status)), []);

  const refresh = useCallback(async () => {
    const open = ref.current.filter((r) => !FINAL_STATUSES.has(r.status));
    await Promise.all(open.map(async (r) => {
      try { setStatus(r.invoice_id, (await api.status(r.invoice_id)).status); } catch { /* offline: keep the last known status */ }
    }));
  }, [setStatus]);

  return { recents, add, setStatus, refresh };
}
