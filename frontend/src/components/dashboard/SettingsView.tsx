import { useEffect, useState } from "react";
import { AlertTriangle, Check, CircleDot, Keyboard, LogOut, Monitor, Moon, Pin, RefreshCw, ShieldCheck, Sun, Trash2 } from "lucide-react";
import { usePinned } from "../../hooks/usePinned";
import { useRequest } from "../../hooks/useRequest";
import { useTheme } from "../../hooks/useTheme";
import { api } from "../../lib/api";
import { prettyHotkey } from "../../lib/format";
import { loadRecents, saveRecents } from "../../lib/recents";
import { getAppInfo, isTauri, quitApp, type AppInfo } from "../../lib/tauri";
import type { BackendInfo } from "../../lib/types";
import { Segmented, Switch } from "./Controls";

const THEME_OPTIONS = [
  { value: "system", label: "System", icon: <Monitor size={14} aria-hidden /> },
  { value: "light", label: "Light", icon: <Sun size={14} aria-hidden /> },
  { value: "dark", label: "Dark", icon: <Moon size={14} aria-hidden /> },
] as const;

type Tone = "ok" | "warn" | "bad";
const TONE_CLASS: Record<Tone, string> = { ok: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn", bad: "bg-bad/15 text-bad" };

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${TONE_CLASS[tone]}`}><CircleDot size={11} aria-hidden />{children}</span>;
}

function Card({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="glass shrink-0">
      <div className="border-b border-line px-5 py-3.5">
        <h2 id={id} className="text-[15px] font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-faint">{description}</p>}
      </div>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12.5px] text-ink-faint">{hint}</div>}
      </div>
      <div className="shrink-0 text-right text-[13.5px]">{children}</div>
    </div>
  );
}

const llmView = (info: BackendInfo["llm"]): { tone: Tone; text: string; hint: string } => {
  switch (info.status) {
    case "ok": return { tone: "ok", text: "Ready", hint: `${info.model} runs locally. Your text stays on this computer.` };
    case "model_missing": return { tone: "warn", text: "Model not installed", hint: `Run: ollama pull ${info.model}` };
    case "offline": return { tone: "warn", text: "Ollama not running", hint: "Mercury Cmd uses its rule-based parser (Basic mode) until Ollama is started." };
    default: return { tone: "warn", text: "Disabled", hint: "LLM_PROVIDER=none: Basic mode only (one item per invoice)." };
  }
};

export default function SettingsView() {
  const theme = useTheme();
  const pin = usePinned();
  const info = useRequest((signal) => api.info(signal), "info");
  const [native, setNative] = useState<AppInfo | null>(null);
  const [recentCount, setRecentCount] = useState(() => loadRecents().length);

  useEffect(() => { void getAppInfo().then(setNative).catch(() => {}); }, []);

  const clearRecents = () => { saveRecents([]); setRecentCount(0); };
  const b = info.data;

  return (
    <div className="mx-auto flex h-full max-w-[760px] flex-col gap-4 overflow-auto p-5">
      <header className="shrink-0 px-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-[13.5px] text-ink-faint">How Mercury Cmd looks, behaves and connects.</p>
      </header>

      <Card id="appearance" title="Appearance">
        <Row label="Theme" hint="System follows your Mac's appearance.">
          <Segmented label="Theme" value={theme.mode} options={[...THEME_OPTIONS]} onChange={(v) => theme.setMode(v)} />
        </Row>
      </Card>

      <Card id="palette" title="Palette" description="The quick window you open from anywhere.">
        <Row label="Shortcut" hint={isTauri ? "Change it with MERCURY_HOTKEY (for example Alt+Space), then restart the app." : "Browser mode: press ⌘K to focus the input."}>
          {isTauri && native ? (
            <span className="flex items-center gap-2">
              <kbd className="kbd !text-[13px]"><Keyboard size={12} aria-hidden className="mr-1 inline" />{prettyHotkey(native.hotkey)}</kbd>
              <Badge tone={native.hotkey_registered ? "ok" : "bad"}>{native.hotkey_registered ? "Active" : "In use by another app"}</Badge>
            </span>
          ) : <kbd className="kbd !text-[13px]">⌘K</kbd>}
        </Row>
        {isTauri && (
          <Row label="Keep the palette open" hint="Don't hide it when you click another app. Useful for copying details from elsewhere.">
            <span className="flex items-center gap-2"><Pin size={14} aria-hidden className="text-ink-faint" /><Switch label="Keep the palette open when I click away" checked={pin.pinned} onChange={pin.set} /></span>
          </Row>
        )}
      </Card>

      <Card id="connections" title="Connections" description="Live status of everything Mercury Cmd talks to.">
        {info.error && !b ? (
          <div role="alert" className="flex items-start gap-3 px-5 py-4 text-[13.5px] text-bad">
            <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p>{info.error}</p>
              {info.backendDown && <p className="mt-1 text-ink-dim">Start it with <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-ink">make dev-web</code> or <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12.5px] text-ink">make backend</code>.</p>}
            </div>
            <button type="button" onClick={info.reload} className="rounded-lg bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-line">Retry</button>
          </div>
        ) : !b ? (
          <div className="space-y-3 p-5" role="status" aria-label="Checking connections"><div className="shimmer h-5 w-1/2 rounded" /><div className="shimmer h-5 w-2/3 rounded" /><div className="shimmer h-5 w-1/3 rounded" /></div>
        ) : (
          <>
            <Row label="PayPal sandbox" hint={<>{b.paypal.host}{b.paypal.merchant_email && <><br />Merchant: {b.paypal.merchant_email}</>}</>}>
              {b.paypal.status === "ok" ? <Badge tone="ok">Connected</Badge> : <Badge tone="bad">{b.paypal.error ?? "Error"}</Badge>}
            </Row>
            <Row label="AI parser" hint={llmView(b.llm).hint}><Badge tone={llmView(b.llm).tone}>{llmView(b.llm).text}</Badge></Row>
            <Row label="Backend" hint="The local service that talks to PayPal and the AI model."><Badge tone="ok">Connected · v{b.version}</Badge></Row>
            <div className="flex justify-end px-5 py-2.5">
              <button type="button" onClick={info.reload} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-dim transition hover:bg-surface-2 hover:text-ink">
                <RefreshCw size={13} aria-hidden className={info.loading ? "animate-spin" : ""} />Check again
              </button>
            </div>
          </>
        )}
      </Card>

      <Card id="data" title="Data on this device">
        <Row label="Recent invoices" hint="The short list in the palette. Your full history always comes from PayPal.">
          <span className="flex items-center gap-3">
            <span className="text-ink-dim tabular-nums">{recentCount} saved</span>
            <button type="button" disabled={recentCount === 0} onClick={clearRecents}
              className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-[13px] font-medium transition hover:bg-line disabled:opacity-40"><Trash2 size={13} aria-hidden />Clear</button>
          </span>
        </Row>
      </Card>

      <Card id="about" title="About">
        <Row label="Mercury Cmd" hint="Say it in plain English. Get paid with PayPal."><span className="text-ink-dim">{native ? `App v${native.version}` : "Browser mode"}{b && ` · Backend v${b.version}`}</span></Row>
        <Row label="Sandbox only" hint="Every PayPal call uses the sandbox. No real money moves."><Badge tone="ok"><ShieldCheck size={12} aria-hidden />Safe to test</Badge></Row>
        <Row label="License"><span className="text-ink-dim">MIT</span></Row>
        {isTauri && (
          <Row label="Quit Mercury Cmd" hint="Closes the menu-bar icon and the palette shortcut.">
            <button type="button" onClick={() => void quitApp()} className="flex items-center gap-1.5 rounded-lg bg-bad/12 px-3 py-1.5 text-[13px] font-medium text-bad transition hover:bg-bad/20"><LogOut size={13} aria-hidden />Quit</button>
          </Row>
        )}
      </Card>
      <p className="px-1 pb-2 text-[12px] text-ink-faint"><Check size={11} aria-hidden className="mr-1 inline" />Settings are saved on this device.</p>
    </div>
  );
}
