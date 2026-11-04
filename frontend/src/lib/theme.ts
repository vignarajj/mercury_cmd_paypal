export type ThemeMode = "system" | "light" | "dark";

const KEY = "mercury.theme";

export const NEXT_MODE: Record<ThemeMode, ThemeMode> = { system: "light", light: "dark", dark: "system" };

export function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch { /* storage can be unavailable; fall back to the system theme */ }
  return "system";
}

/** "system" removes the override so the prefers-color-scheme media query decides. */
export function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") delete root.dataset.theme;
  else root.dataset.theme = mode;
  try {
    if (mode === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch { /* ignore */ }
}
