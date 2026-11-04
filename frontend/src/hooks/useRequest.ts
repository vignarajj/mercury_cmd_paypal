import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/api";

export interface RequestState<T> { data: T | null; loading: boolean; error: string | null; backendDown: boolean }

/** Run an abortable request whenever `key` changes; `reload()` runs it again. Keeps the last data while reloading. */
export function useRequest<T>(run: ((signal: AbortSignal) => Promise<T>) | null, key: string) {
  const [state, setState] = useState<RequestState<T>>({ data: null, loading: !!run, error: null, backendDown: false });
  const [nonce, setNonce] = useState(0);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const fn = runRef.current;
    if (!fn) { setState({ data: null, loading: false, error: null, backendDown: false }); return; }
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null, backendDown: false }));
    fn(ac.signal)
      .then((data) => setState({ data, loading: false, error: null, backendDown: false }))
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        const down = e instanceof ApiError && e.code === "BACKEND_DOWN";
        setState((s) => ({ ...s, loading: false, backendDown: down, error: e instanceof ApiError ? e.message : "Something went wrong. Try again." }));
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
