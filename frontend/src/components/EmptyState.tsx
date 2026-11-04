import { useRef, useState } from "react";
import { Check, Copy, ExternalLink, Wand2 } from "lucide-react";
import { copyText, openExternal } from "../lib/tauri";
import { formatMoney } from "../lib/invoice";
import { relativeTime, type Recent } from "../lib/recents";
import StatusPill from "./StatusPill";

export const EXAMPLES = [
  "Bill client@acme.co $500 for logo design, net 15",
  "Invoice sarah@studio.io $1,200 for brand refresh and $300 for icons, net 30",
  "Charge dev@startup.com 3 hours of consulting at $100 per hour, due on receipt",
];

interface Props { recents: Recent[]; onExample: (text: string) => void; onLeaveUp: () => void }

/** What you see before typing: one-click examples and the last few invoices with live status. */
export default function EmptyState({ recents, onExample, onLeaveUp }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Arrow keys move through every focusable item; Up from the first returns to the input.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>("[data-nav]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    if (e.key === "ArrowUp" && at === 0) return onLeaveUp();
    items[Math.min(items.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
  };

  const copy = async (r: Recent) => {
    if (await copyText(r.url)) { setCopied(r.invoice_id); setTimeout(() => setCopied(null), 1500); }
  };

  return (
    <div ref={root} onKeyDown={onKeyDown} className="border-t border-line px-4 pb-3 pt-3">
      <h2 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint"><Wand2 size={12} aria-hidden />Try an example</h2>
      <ul className="flex flex-col gap-1.5">
        {EXAMPLES.map((ex) => (
          <li key={ex}>
            <button type="button" data-nav onClick={() => onExample(ex)}
              className="w-full truncate rounded-lg bg-surface px-3 py-2 text-left text-[13.5px] text-ink-dim transition hover:bg-surface-2 hover:text-ink">
              {ex}
            </button>
          </li>
        ))}
      </ul>

      {recents.length > 0 && (
        <>
          <h2 className="mb-2 mt-4 text-[11.5px] font-semibold uppercase tracking-wider text-ink-faint">Recent invoices</h2>
          <ul className="flex flex-col gap-1">
            {recents.map((r) => (
              <li key={r.invoice_id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-surface">
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#009cde] to-[#003087] text-[13px] font-semibold uppercase text-white">
                  {r.client_email.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] text-ink">{r.client_email}</p>
                  <p className="text-[12px] text-ink-faint"><span className="tabular-nums text-ink-dim">{formatMoney(Math.round(Number(r.total) * 100), r.currency)}</span> · {relativeTime(r.ts)}</p>
                </div>
                <StatusPill status={r.status} compact />
                <button type="button" data-nav aria-label={`Copy payment link for ${r.client_email}`} onClick={() => void copy(r)}
                  className="grid size-7 place-items-center rounded-md text-ink-faint transition hover:bg-surface-2 hover:text-ink">
                  {copied === r.invoice_id ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                </button>
                <button type="button" data-nav aria-label={`Open invoice for ${r.client_email}`} onClick={() => void openExternal(r.url)}
                  className="grid size-7 place-items-center rounded-md text-ink-faint transition hover:bg-surface-2 hover:text-ink"><ExternalLink size={14} /></button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
