import { useState } from "react";
import { AlertTriangle, Check, Cloud, Copy, Cpu } from "lucide-react";
import { useRequest } from "../../hooks/useRequest";
import { ApiError, api } from "../../lib/api";
import type { ModelState } from "../../lib/types";
import SelectField from "../SelectField";
import { Switch } from "./Controls";
import { Badge, Card, Row } from "./SettingsParts";

const REASON: Record<"cloud" | "embedding", string> = {
  cloud: "Runs on ollama.com. Turn on cloud models above to use it",
  embedding: "Search model; it can't read a sentence and fill an invoice",
};

function Unavailable({ items }: { items: ModelState["unavailable"] }) {
  return (
    <details className="group px-5 py-3 text-[13px]">
      <summary className="cursor-pointer select-none font-medium text-ink-dim hover:text-ink">
        {items.length} other {items.length === 1 ? "model" : "models"} in Ollama can't be used here
      </summary>
      <ul className="mt-2 space-y-1.5">
        {items.map((x) => (
          <li key={x.name} className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-[12.5px] text-ink">{x.name}</span>
            <span className="text-right text-[12px] text-ink-faint">{REASON[x.reason]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[12px] font-semibold text-accent">{n}</span>
      <div className="min-w-0 space-y-1.5">
        <div className="font-medium text-ink">{title}</div>
        <div className="space-y-1.5 text-ink-dim">{children}</div>
      </div>
    </li>
  );
}

/** Step-by-step help for people who have not used Ollama before. Open by default until a model is ready. */
function OllamaGuide({ state }: { state: ModelState }) {
  const model = state.default;
  return (
    <details open={state.status !== "ok"} className="px-5 py-3 text-[13.5px]">
      <summary className="cursor-pointer select-none font-medium text-ink-dim hover:text-ink">How to set up Ollama and a local model</summary>
      <ol className="mt-3 space-y-4">
        <Step n={1} title="Install Ollama">
          <p>Download the Mac app from ollama.com/download and open it. Or with Homebrew:</p>
          <p><Command text="brew install ollama" /></p>
        </Step>
        <Step n={2} title="Make sure it is running">
          <p>The Ollama app shows a llama icon in the menu bar. With Homebrew, start it in Terminal and leave that window open:</p>
          <p><Command text="ollama serve" /></p>
        </Step>
        <Step n={3} title="Download a model (one time)">
          <p>This is the model Mercury Cmd was tested with. It is about 4.3 GB.</p>
          <p><Command text={`ollama pull ${model}`} /></p>
        </Step>
        <Step n={4} title="Check it worked">
          <p>The model should appear in this list:</p>
          <p><Command text="ollama list" /></p>
          <p>Then press <span className="font-medium text-ink">Check again</span> below. It switches to Ready.</p>
        </Step>
      </ol>
      <div className="mt-4 space-y-1.5 rounded-xl bg-surface-2 px-4 py-3 text-[12.5px] text-ink-dim">
        <p><span className="font-medium text-ink">Want a different model?</span> Run <span className="font-mono text-ink">ollama pull &lt;name&gt;</span>, press Check again, and choose it above. Any local chat model is listed. Embedding models never are, and cloud models appear only after you turn them on.</p>
        <p><span className="font-medium text-ink">Ollama on another address?</span> Set <span className="font-mono text-ink">OLLAMA_BASE_URL</span> in <span className="font-mono text-ink">backend/.env</span> and restart the backend. Currently: <span className="font-mono text-ink">{state.base_url ?? "http://localhost:11434"}</span></p>
        <p><span className="font-medium text-ink">Slow first invoice?</span> The first read after the model has been idle can take 10 to 15 seconds while it loads, and past 8 seconds that read uses Basic mode. Later ones take a few seconds.</p>
      </div>
    </details>
  );
}

const gigabytes = (bytes: number | null) => (bytes ? ` · ${(bytes / 1e9).toFixed(1)} GB` : "");

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };
  return (
    <span className="inline-flex items-center gap-2 rounded-lg bg-surface-2 py-1 pl-3 pr-1 font-mono text-[12.5px] text-ink">
      {text}
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : `Copy ${text}`}
        className="flex items-center gap-1 rounded-md px-2 py-1 font-sans text-[12px] font-medium text-ink-dim transition hover:bg-line hover:text-ink">
        {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}{copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function StatusBadge({ state }: { state: ModelState }) {
  switch (state.status) {
    case "ok": return <Badge tone="ok">Ready</Badge>;
    case "model_missing": return <Badge tone="warn">Not installed</Badge>;
    case "offline": return <Badge tone="warn">Ollama not running</Badge>;
    default: return <Badge tone="warn">Turned off</Badge>;
  }
}

/** Where the parsing model is chosen. Shows what is installed in Ollama and how to get a model if nothing is. */
export default function ModelCard({ onChanged }: { onChanged?: () => void }) {
  const models = useRequest((signal) => api.models(signal), "models");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [override, setOverride] = useState<ModelState | null>(null);
  const m = override ?? models.data;

  const choose = async (name: string) => {
    setSaving(true); setError(null); setSaved(null);
    try {
      setOverride(await api.setModel(name));
      setSaved(`Now using ${name}.`);
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not switch the model. Try again.");
    } finally { setSaving(false); }
  };
  const toggleCloud = async (allow: boolean) => {
    setSaving(true); setError(null); setSaved(null);
    try {
      const before = (override ?? models.data)?.current;
      const next = await api.allowCloud(allow);
      setOverride(next);
      setSaved(allow ? "Cloud models are on. Pick one from the list to use it." : next.current !== before ? `Cloud models are off. Back to ${next.current}.` : "Cloud models are off.");
      if (next.current !== before) onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change that setting. Try again.");
    } finally { setSaving(false); }
  };
  const refresh = () => { setOverride(null); setSaved(null); setError(null); models.reload(); };

  const installed = m?.models ?? [];
  const current = m?.current ?? "";
  const hasCurrent = installed.some((x) => x.name === current);
  const onCloud = installed.some((x) => x.name === current && x.cloud);
  const cloudModels = installed.filter((x) => x.cloud);
  const description = onCloud
    ? "Reads your sentence and fills in the invoice. This model runs on ollama.com, so what you type is sent there."
    : "Reads your sentence and fills in the invoice. It runs on this computer through Ollama, so your text never leaves it.";

  return (
    <Card id="ai-model" title="AI model" description={description}>
      {models.error && !m ? (
        <div role="alert" className="flex items-start gap-3 px-5 py-4 text-[13.5px] text-bad">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />
          <p className="flex-1">{models.error}</p>
          <button type="button" onClick={refresh} className="rounded-lg bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-line">Retry</button>
        </div>
      ) : !m ? (
        <div className="space-y-3 p-5" role="status" aria-label="Checking the AI model"><div className="shimmer h-5 w-1/2 rounded" /><div className="shimmer h-5 w-1/3 rounded" /></div>
      ) : m.status === "disabled" ? (
        <Row label="AI parsing is turned off" hint="Mercury Cmd uses its rule-based parser (Basic mode, one item per invoice). Set LLM_PROVIDER=ollama in backend/.env and restart the backend to turn it on."><StatusBadge state={m} /></Row>
      ) : (
        <>
          <Row label="Model" hint={m.status === "offline" ? "Start Ollama to see your installed models." : installed.length ? "Choose from the models installed in Ollama. The change applies right away." : "No local models found yet. Follow the steps below."}>
            <span className="flex items-center gap-3">
              <StatusBadge state={m} />
              {onCloud && <Badge tone="warn"><Cloud size={12} aria-hidden />Cloud</Badge>}
              {installed.length > 0 && (
                <SelectField label="AI model" icon={Cpu} value={current} disabled={saving} onChange={(v) => void choose(v)}>
                  {!hasCurrent && <option value={current} disabled>{current} (not installed)</option>}
                  {installed.map((x) => (
                    <option key={x.name} value={x.name}>{x.name}{x.name === m.default ? " (recommended)" : ""}{x.cloud ? " · cloud" : gigabytes(x.size_bytes)}</option>
                  ))}
                </SelectField>
              )}
            </span>
          </Row>
          {m.status !== "offline" && (
            <Row label="Cloud models" hint="Off by default. Ollama's cloud models run on ollama.com, so everything you type is sent there. Needs an Ollama account (run ollama signin).">
              <span className="flex items-center gap-2">
                <Cloud size={14} aria-hidden className="text-ink-faint" />
                <Switch label="Allow cloud models" checked={m.allow_cloud} onChange={(v) => { if (!saving) void toggleCloud(v); }} />
              </span>
            </Row>
          )}
          {m.allow_cloud && (
            <div role="note" className="px-5 py-3 text-[12.5px] text-warn">
              {cloudModels.length > 0
                ? `Cloud models are on. If you choose one, your invoice sentences go to ollama.com. Keep it off for private work.`
                : "Cloud models are on, but Ollama lists none. Run ollama signin, then press Check again."}
            </div>
          )}
          {(error || saved) && (
            <div role={error ? "alert" : "status"} className={`px-5 py-3 text-[13px] ${error ? "text-bad" : "text-ok"}`}>
              {error ?? saved}
            </div>
          )}
          {m.current && m.current !== m.default && m.status === "ok" && (
            <div className="px-5 py-3 text-[12.5px] text-ink-faint">
              Only <span className="font-mono text-ink-dim">{m.default}</span> has been tested against Mercury Cmd's 33 example sentences. Other models work, but check the preview before sending.
            </div>
          )}
          {m.unavailable.length > 0 && <Unavailable items={m.unavailable} />}
          <OllamaGuide state={m} />
          <div className="flex items-center justify-between gap-4 px-5 py-2.5">
            <p className="text-[12px] text-ink-faint">The default comes from OLLAMA_MODEL in backend/.env.{m.allow_cloud ? "" : " Cloud models are hidden to keep your text on this computer."}</p>
            <button type="button" onClick={refresh} className="shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-dim transition hover:bg-surface-2 hover:text-ink">Check again</button>
          </div>
        </>
      )}
    </Card>
  );
}
