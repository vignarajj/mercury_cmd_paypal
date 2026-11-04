import { useCallback, useEffect, useState } from "react";
import { setPinned as setNativePinned } from "../lib/tauri";

const KEY = "mercury.pinned";

const read = (): boolean => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};

/**
 * "Keep the palette open when I click away." Stored locally, mirrored to the native window, and kept in sync
 * across the palette and the Dashboard (they share storage, so the `storage` event fires in the other one).
 */
export function usePinned() {
  const [pinned, setPinned] = useState(read);

  useEffect(() => { void setNativePinned(pinned).catch(() => {}); }, [pinned]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setPinned(read()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const set = useCallback((value: boolean) => {
    try { localStorage.setItem(KEY, value ? "1" : "0"); } catch { /* storage unavailable: still applies this session */ }
    setPinned(value);
  }, []);
  const toggle = useCallback(() => set(!read()), [set]);
  return { pinned, set, toggle };
}
