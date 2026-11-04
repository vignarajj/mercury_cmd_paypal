import { useState } from "react";
import { AlertTriangle, Check, Copy, Cpu } from "lucide-react";
import { useRequest } from "../../hooks/useRequest";
import { ApiError, api } from "../../lib/api";
import type { ModelState } from "../../lib/types";
import SelectField from "../SelectField";
import { Badge, Card, Row } from "./SettingsParts";

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
      setSaved(name);
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not switch the model. Try again.");
    } finally { setSaving(false); }
  };
  const refresh = () => { setOverride(null); setSaved(null); setError(null); models.reload(); };

  const installed = m?.models ?? [];
  const current = m?.current ?? "";
  const hasCurrent = installed.some((x) => x.name === current);
  const pull = `ollama pull ${m?.default ?? "gemma4:e2b-it-qat"}`;

  return (
    <Card id="ai-model" title="AI model" description="Reads your sentence and fills in the invoice. It runs on this computer through Ollama, so your text never leaves it.">
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
              {installed.length > 0 && (
                <SelectField label="AI model" icon={Cpu} value={current} disabled={saving} onChange={(v) => void choose(v)}>
                  {!hasCurrent && <option value={current} disabled>{current} (not installed)</option>}
                  {installed.map((x) => (
                    <option key={x.name} value={x.name}>{x.name}{x.name === m.default ? " (recommended)" : ""}{gigabytes(x.size_bytes)}</option>
                  ))}
                </SelectField>
              )}
            </span>
          </Row>
          {(error || saved) && (
            <div role={error ? "alert" : "status"} className={`px-5 py-3 text-[13px] ${error ? "text-bad" : "text-ok"}`}>
              {error ?? `Now using ${saved}.`}
            </div>
          )}
          {m.current && m.current !== m.default && m.status === "ok" && (
            <div className="px-5 py-3 text-[12.5px] text-ink-faint">
              Only <span className="font-mono text-ink-dim">{m.default}</span> has been tested against Mercury Cmd's 33 example sentences. Other models work, but check the preview before sending.
            </div>
          )}
          {m.status !== "ok" && (
            <ol className="space-y-3 px-5 py-4 text-[13.5px] text-ink-dim">
              <li><span className="font-medium text-ink">1. Install Ollama</span> from ollama.com/download and open it.</li>
              <li className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">2. Download the model</span> in Terminal: <Command text={pull} /></li>
              <li><span className="font-medium text-ink">3. Come back here</span> and press Check again.</li>
            </ol>
          )}
          <div className="flex items-center justify-between gap-4 px-5 py-2.5">
            <p className="text-[12px] text-ink-faint">The default comes from OLLAMA_MODEL in backend/.env. Cloud models are hidden to keep your text on this computer.</p>
            <button type="button" onClick={refresh} className="shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-dim transition hover:bg-surface-2 hover:text-ink">Check again</button>
          </div>
        </>
      )}
    </Card>
  );
}
