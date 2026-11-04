// Thin wrappers so the same UI runs inside Tauri (hotkey window) and in a plain browser (web mode).
import type { UnlistenFn } from "@tauri-apps/api/event";

/** The label of the native window this page runs in ("main" palette or "dashboard"), or null in a browser. */
export const nativeWindowLabel = (): string | null =>
  (typeof window !== "undefined" &&
    (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label) ||
  null;

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function hideWindow() {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export async function setWindowHeight(height: number) {
  if (!isTauri) return;
  const [{ getCurrentWindow }, { LogicalSize }] = await Promise.all([
    import("@tauri-apps/api/window"),
    import("@tauri-apps/api/dpi"),
  ]);
  await getCurrentWindow().setSize(new LogicalSize(680, height));
}

export async function onPaletteShown(cb: () => void): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen("palette:shown", cb);
}

export async function openExternal(url: string) {
  // Defense in depth: the link comes from our backend, but never open anything that is not a PayPal https URL.
  const u = new URL(url);
  if (u.protocol !== "https:" || !(u.hostname === "paypal.com" || u.hostname.endsWith(".paypal.com"))) return;
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** Tell the native window which appearance to use so vibrancy matches (null = follow the system). */
export async function setNativeTheme(theme: "light" | "dark" | null) {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTheme(theme);
}

export interface AppInfo { version: string; hotkey: string; hotkey_registered: boolean; pinned: boolean; platform: string }

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const getAppInfo = (): Promise<AppInfo | null> => (isTauri ? call<AppInfo>("get_app_info") : Promise.resolve(null));
export const setPinned = async (pinned: boolean) => { if (isTauri) await call("set_pinned", { pinned }); };
export const quitApp = async () => { if (isTauri) await call("quit_app"); };
export const showPalette = async () => { if (isTauri) await call("show_palette"); };

/** Desktop: the Dashboard is its own window with normal controls. Browser: a new tab on the same app. */
export async function openDashboard() {
  if (isTauri) await call("open_dashboard");
  else window.open(`${location.pathname}#/dashboard`, "_blank");
}
