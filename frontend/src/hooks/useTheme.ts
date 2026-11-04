import { useCallback, useEffect, useState } from "react";
import { setNativeTheme } from "../lib/tauri";
import { applyMode, NEXT_MODE, readMode, type ThemeMode } from "../lib/theme";

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyMode(mode);
    void setNativeTheme(mode === "system" ? null : mode);
  }, [mode]);

  const cycle = useCallback(() => setMode((m) => NEXT_MODE[m]), []);
  const resolved: "light" | "dark" = mode === "system" ? (systemDark ? "dark" : "light") : mode;
  return { mode, resolved, cycle };
}
