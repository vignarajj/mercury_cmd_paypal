import { useEffect, useState } from "react";
import { FileText, PanelTop, Settings } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import { isTauri, showPalette } from "../../lib/tauri";
import InvoicesView from "./InvoicesView";
import SettingsView from "./SettingsView";

type View = "invoices" | "settings";
const NAV: { id: View; label: string; icon: typeof FileText }[] = [
  { id: "invoices", label: "Invoices", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
];

const viewFromHash = (): View => (location.hash.includes("/settings") ? "settings" : "invoices");

/** The full-size window: invoice history and detail, settings, and connection health. */
export default function Dashboard() {
  useTheme(); // applies the saved theme and the native window theme
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const on = () => setView(viewFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => { document.title = view === "settings" ? "Settings · Mercury Cmd" : "Invoices · Mercury Cmd"; }, [view]);

  const go = (v: View) => { setView(v); history.replaceState(null, "", `#/dashboard${v === "settings" ? "/settings" : ""}`); };

  return (
    <div className="flex h-full w-full text-ink">
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-surface/60 px-3 py-4">
        <div className="mb-5 flex items-center gap-2.5 px-2">
          <img src="/mercury.svg" alt="" className="size-8" draggable={false} />
          <div className="leading-tight"><div className="text-[15px] font-semibold tracking-tight">Mercury Cmd</div><div className="text-[11.5px] text-ink-faint">Dashboard</div></div>
        </div>
        <nav aria-label="Dashboard sections" className="flex flex-col gap-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => go(id)}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] font-medium transition ${view === id ? "bg-accent/15 text-accent" : "text-ink-dim hover:bg-surface-2 hover:text-ink"}`}>
              <Icon size={16} aria-hidden />{label}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-1">
          {isTauri && (
            <button type="button" onClick={() => void showPalette()}
              className="flex w-full items-center gap-2 rounded-xl bg-cta px-3 py-2 text-[13.5px] font-semibold text-cta-ink transition hover:brightness-105">
              <PanelTop size={15} aria-hidden />New invoice
            </button>
          )}
          <span className="inline-block rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tracking-wider text-ink-dim" title="No real money moves. All PayPal calls use the sandbox.">SANDBOX</span>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden" aria-label={view === "settings" ? "Settings" : "Invoices"}>
        {view === "invoices" ? <InvoicesView /> : <SettingsView />}
      </main>
    </div>
  );
}
