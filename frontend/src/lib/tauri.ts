// Thin wrappers so the same UI runs inside Tauri (hotkey window) and in a plain browser (web mode).
import type { UnlistenFn } from "@tauri-apps/api/event";

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
