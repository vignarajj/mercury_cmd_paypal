import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

/** WCAG 2.x contrast for every text/background pair the UI uses, in both themes. */
type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (fg: RGB, alpha: number, bg: RGB): RGB => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as RGB;

function vars(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}
const dark = vars(css.match(/:root\s*\{([^}]*)\}/)![1]);
const light = vars(css.match(/:root\[data-theme="light"\]\s*\{([^}]*)\}/)![1]);

// Estimated worst-case surfaces behind the glass (native vibrancy over a typical wallpaper).
const THEMES = [
  { name: "dark", t: dark, backdrop: hex("#0b1736"), overlay: [255, 255, 255] as RGB },
  { name: "light", t: light, backdrop: hex("#f2f6ff"), overlay: [0, 48, 135] as RGB },
];
const SEMANTIC = ["accent", "ok", "warn", "bad", "hl-email", "hl-amount", "hl-term", "hl-cur"];

describe.each(THEMES)("$name theme contrast", ({ t, backdrop, overlay }) => {
  it("has every token defined", () => {
    for (const k of ["ink", "ink-dim", "ink-faint", "accent", "accent-ink", "cta", "cta-ink", ...SEMANTIC]) expect(t[k], k).toBeTruthy();
  });
  it("body text meets AAA, secondary text meets AA", () => {
    expect(ratio(hex(t.ink), backdrop)).toBeGreaterThanOrEqual(7);
    expect(ratio(hex(t["ink-dim"]), backdrop)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(t["ink-faint"]), backdrop)).toBeGreaterThanOrEqual(4.5);
  });
  it("secondary text stays readable on raised surfaces", () => {
    const raised = mix(overlay, 0.11, backdrop);
    expect(ratio(hex(t["ink-dim"]), raised)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(t.ink), raised)).toBeGreaterThanOrEqual(7);
  });
  it.each(SEMANTIC)("%s is readable as text, alone and on its own 16% tint", (k) => {
    expect(ratio(hex(t[k]), backdrop), `${k} on backdrop`).toBeGreaterThanOrEqual(4.5);
    expect(ratio(hex(t[k]), mix(hex(t[k]), 0.16, backdrop)), `${k} on tint`).toBeGreaterThanOrEqual(4.5);
  });
  it("buttons are readable: gold call-to-action and accent fill", () => {
    expect(ratio(hex(t["cta-ink"]), hex(t.cta))).toBeGreaterThanOrEqual(7);
    expect(ratio(hex(t["accent-ink"]), hex(t.accent))).toBeGreaterThanOrEqual(4.5);
  });
});
