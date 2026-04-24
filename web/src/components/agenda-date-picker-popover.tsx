"use client";

import { useEffect, useRef, useState } from "react";
import { formatLocalYmd, isYmdToday, parseLocalYmd } from "@/lib/local-day";

type Props = {
  dayKey: string;
  disabled?: boolean;
  onSelectDay: (ymd: string) => void;
  label?: string;
};

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function monthGrid(year: number, monthIndex: number): (number | null)[] {
  const firstWd = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const dim = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWd; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

export function AgendaDatePickerPopover({
  dayKey,
  disabled,
  onSelectDay,
  label = "Data",
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [cursor, setCursor] = useState(() => {
    if (dayKey) {
      try {
        return parseLocalYmd(dayKey);
      } catch {
        /* fallthrough */
      }
    }
    return new Date();
  });

  useEffect(() => {
    if (!open || !dayKey) return;
    try {
      setCursor(parseLocalYmd(dayKey));
    } catch {
      /* ignore */
    }
  }, [open, dayKey]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const cells = monthGrid(y, m);
  const title = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(y, m, 1));

  const displayDate = dayKey
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(parseLocalYmd(dayKey))
    : "—";

  const btnClass =
    "inline-flex min-h-[2.75rem] items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-sans text-sm font-medium text-[var(--text)] shadow-sm transition-colors hover:bg-[var(--surface-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:pointer-events-none disabled:opacity-50";

  return (
    <div ref={wrapRef} className="relative">
      <span className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
        <span className="sr-only sm:not-sr-only">{label}</span>
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((o) => !o)}
          className={btnClass}
        >
          <span className="tabular-nums">{displayDate}</span>
          <IconCalendar className="shrink-0 text-[var(--text-muted)]" />
        </button>
      </span>

      {open && !disabled ? (
        <div
          role="dialog"
          aria-label="Escolher data na agenda"
          className="absolute left-0 top-full z-50 mt-2 w-[min(100vw-1.5rem,20rem)] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] text-lg font-semibold text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)]"
              aria-label="Mês anterior"
              onClick={() => setCursor(new Date(y, m - 1, 1))}
            >
              ‹
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold capitalize text-[var(--text)]">
              {title}
            </span>
            <button
              type="button"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] text-lg font-semibold text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)]"
              aria-label="Mês seguinte"
              onClick={() => setCursor(new Date(y, m + 1, 1))}
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {WEEKDAYS.map((wd) => (
              <div key={wd} className="py-1">
                {wd}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (d == null) {
                return <div key={`e-${i}`} className="aspect-square" />;
              }
              const ymd = formatLocalYmd(new Date(y, m, d));
              const sel = dayKey === ymd;
              const today = isYmdToday(ymd);
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => {
                    onSelectDay(ymd);
                    setOpen(false);
                  }}
                  className={[
                    "flex aspect-square items-center justify-center rounded-lg text-sm font-medium tabular-nums transition-colors",
                    sel
                      ? "bg-[var(--primary)] text-white shadow-sm"
                      : "text-[var(--text)] hover:bg-[var(--surface-soft)]",
                    !sel && today
                      ? "ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--surface)]"
                      : "",
                  ].join(" ")}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
