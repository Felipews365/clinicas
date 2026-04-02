"use client";

import { useEffect, useRef, useState } from "react";

/** Anima valor numérico até `value` em ~durationMs (ease-out). */
export function useAnimatedNumber(value: number, durationMs = 650): number {
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    const from = displayRef.current;
    let startTime: number | null = null;
    let raf = 0;
    let alive = true;

    const tick = (t: number) => {
      if (!alive) return;
      if (startTime == null) startTime = t;
      const elapsed = t - startTime;
      const p = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - p) * (1 - p);
      setDisplay(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [value, durationMs]);

  return display;
}
