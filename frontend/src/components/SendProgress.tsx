import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

const STEPS = ["Authenticating", "Creating draft", "Sending"];

/** Timed stepper tied to one request: advances on a timer, holds on the last step until the response lands. */
export default function SendProgress() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = [setTimeout(() => setStep(1), 500), setTimeout(() => setStep(2), 1300)];
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <ol className="flex items-center gap-4 text-[13px]" aria-live="polite">
      {STEPS.map((label, i) => (
        <li key={label} className={`flex items-center gap-1.5 ${i <= step ? "text-white" : "text-white/35"}`}>
          {i < step ? <Check size={14} className="text-ok" /> : i === step ? <Loader2 size={14} className="animate-spin text-accent" /> : <span className="size-3.5 rounded-full border border-white/20" />}
          {label}
        </li>
      ))}
    </ol>
  );
}
