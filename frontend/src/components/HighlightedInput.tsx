import { forwardRef, useCallback, useLayoutEffect, useMemo, useRef, type InputHTMLAttributes } from "react";
import { tokenize } from "../lib/entities";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "value"> & { value: string };

/** A normal <input> (native caret, selection, IME) with colored entity tokens painted underneath it. */
const HighlightedInput = forwardRef<HTMLInputElement, Props>(function HighlightedInput({ value, onScroll, onChange, ...rest }, ref) {
  const mirror = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const segments = useMemo(() => tokenize(value), [value]);

  const sync = useCallback(() => {
    if (mirror.current && input.current) mirror.current.scrollLeft = input.current.scrollLeft;
  }, []);
  useLayoutEffect(sync, [value, sync]);

  return (
    <div className="relative min-w-0 flex-1">
      <div ref={mirror} className="mirror" aria-hidden>
        {segments.map((s, i) => (s.kind === "text" ? <span key={i}>{s.text}</span> : <span key={i} className={`hl hl-${s.kind}`}>{s.text}</span>))}
      </div>
      <input
        {...rest}
        ref={(el) => { input.current = el; if (typeof ref === "function") ref(el); else if (ref) ref.current = el; }}
        className="entry" value={value}
        onChange={(e) => { onChange?.(e); requestAnimationFrame(sync); }}
        onScroll={(e) => { sync(); onScroll?.(e); }}
        onSelect={sync} onKeyUp={sync}
        onBlur={(e) => { e.currentTarget.scrollLeft = 0; sync(); rest.onBlur?.(e); }}
      />
    </div>
  );
});

export default HighlightedInput;
