import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface Props {
  text: string;
  /** largest font size in px */
  max?: number;
  /** smallest font size in px before the text is allowed to wrap */
  min?: number;
  className?: string;
  /** lines allowed once the text has to wrap */
  lines?: number;
}

/**
 * Fits one line of text into its column: start at `max` px and shrink until it fits (never below
 * `min`); if it still does not fit at `min`, wrap up to `lines` lines. Measurement uses a canvas so
 * it is independent of the current (possibly wrapped) layout and never causes a reflow loop.
 */
export const AutoFitText: React.FC<Props> = ({
  text,
  max = 20,
  min = 13,
  className,
  lines = 2,
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(max);
  const [wrapped, setWrapped] = useState(false);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof navigator === "undefined" || !document.fonts?.ready) return;
    const available = element.clientWidth;
    if (!available) return;
    const style = window.getComputedStyle(element);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = `${style.fontWeight} ${max}px ${style.fontFamily}`;
    const width = context.measureText(text).width;
    if (!width) return;
    if (width <= available) {
      setSize(max);
      setWrapped(false);
      return;
    }
    // 0.99 leaves a hair of breathing room for font hinting differences.
    const fitted = Math.max(min, Math.floor((max * available * 0.99) / width));
    setSize(fitted);
    // Still too wide at the minimum size → wrap instead of truncating or scrolling sideways.
    setWrapped(fitted <= min && (width * min) / max > available);
  }, [text, max, min]);

  useLayoutEffect(() => {
    measure();
    // Metrics change once the webfont settles.
    let cancelled = false;
    document.fonts?.ready?.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
    };
  }, [measure]);

  // Re-fit when the column width changes (rotation, split screen, larger system font).
  useEffect(() => {
    const element = ref.current;
    const parent = element?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(parent);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <span
      ref={ref}
      className={`auto-fit${wrapped ? " auto-fit--wrap" : ""}${className ? ` ${className}` : ""}`}
      style={{ fontSize: `${size}px`, WebkitLineClamp: wrapped ? lines : undefined }}
      title={text}
    >
      {text}
    </span>
  );
};
