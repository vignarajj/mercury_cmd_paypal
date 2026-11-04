import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  label: string;
  icon: LucideIcon;
  value: string | number;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}

/**
 * A select with a leading icon and our own chevron. The native look is switched off because the macOS
 * WebView draws its own control and ignores left padding, which put the icon on top of the text.
 */
export default function SelectField({ label, icon: Icon, value, disabled, onChange, children }: Props) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <Icon size={14} aria-hidden className="pointer-events-none absolute left-3 text-ink-faint" />
      <select className="field w-auto cursor-pointer appearance-none pl-9 pr-8" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 text-ink-faint" />
    </label>
  );
}
