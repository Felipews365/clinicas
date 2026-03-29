"use client";

import { useMemo, useState } from "react";
import { AppointmentRow, one, statusLabel } from "@/types/appointments";

// ─── tipos ────────────────────────────────────────────────────────────────────

type Period = "week" | "month" | "last_month" | "30d" | "90d";

const PERIOD_LABELS: Record<Period, string> = {
  week: "Esta semana",
  month: "Este mês",
  last_month: "Mês anterior",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function getPeriodRange(period: Period): { from: Date; to: Date } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const today = new Date(y, m, d);

  if (period === "week") {
    const dow = today.getDay();
    const monday = new Date(today);
    monday.setDate(d - (dow === 0 ? 6 : dow - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { from: monday, to: sunday };
  }
  if (period === "month") {
    return {
      from: new Date(y, m, 1),
      to: new Date(y, m + 1, 0, 23, 59, 59, 999),
    };
  }
  if (period === "last_month") {
    return {
      from: new Date(y, m - 1, 1),
      to: new Date(y, m, 0, 23, 59, 59, 999),
    };
  }
  if (period === "30d") {
    const from = new Date(today);
    from.setDate(d - 29);
    return { from, to: new Date(y, m, d, 23, 59, 59, 999) };
  }
  // 90d
  const from = new Date(today);
  from.setDate(d - 89);
  return { from, to: new Date(y, m, d, 23, 59, 59, 999) };
}

function inRange(isoDate: string, from: Date, to: Date): boolean {
  const t = new Date(isoDate).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

function profName(r: AppointmentRow): string {
  return one(r.professionals)?.name ?? "—";
}

function countBy<T>(items: T[], key: (item: T) => string): { label: string; count: number }[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// ─── sub-componentes ──────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className={`rounded-2xl border ${color} px-4 py-3.5`}>
      <p className="text-xs font-medium uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function BarRow({
  label,
  count,
  max,
  colorClass,
}: {
  label: string;
  count: number;
  max: number;
  colorClass: string;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 truncate text-sm font-medium text-[#2c2825]" title={label}>
        {label}
      </span>
      <div className="relative flex-1 overflow-hidden rounded-full bg-[#ede8e0] h-3">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${colorClass} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-right text-sm font-semibold tabular-nums text-[#5c5348]">
        {count}
      </span>
    </div>
  );
}

// ─── componente principal ─────────────────────────────────────────────────────

export function ReportModal({
  open,
  onClose,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  rows: AppointmentRow[];
}) {
  const [period, setPeriod] = useState<Period>("month");

  const filtered = useMemo(() => {
    const { from, to } = getPeriodRange(period);
    return rows.filter((r) => inRange(r.starts_at, from, to));
  }, [rows, period]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const scheduled = filtered.filter((r) => r.status === "scheduled").length;
    const completed = filtered.filter((r) => r.status === "completed").length;
    const cancelled = filtered.filter((r) => r.status === "cancelled").length;

    const fromPainel = filtered.filter((r) => r.source === "painel").length;
    const fromWhatsapp = filtered.filter((r) => r.source === "whatsapp").length;
    const fromOther = total - fromPainel - fromWhatsapp;

    const byProf = countBy(filtered, profName);
    const byService = countBy(
      filtered.filter((r) => r.service_name),
      (r) => r.service_name!,
    );

    return { total, scheduled, completed, cancelled, fromPainel, fromWhatsapp, fromOther, byProf, byService };
  }, [filtered]);

  if (!open) return null;

  const maxProf = stats.byProf[0]?.count ?? 1;
  const maxServ = stats.byService[0]?.count ?? 1;

  return (
    <>
      {/* backdrop */}
      <div
        className="fixed inset-0 z-40 bg-[#1c1917]/45 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden
      />

      {/* painel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Relatório de agendamentos"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border border-[#e4ddd3] bg-[linear-gradient(180deg,#fffdf9_0%,#f8f4ec_100%)] shadow-[0_-8px_48px_-8px_rgba(44,40,37,0.25)] sm:inset-0 sm:m-auto sm:max-h-[90dvh] sm:w-full sm:max-w-2xl sm:rounded-3xl"
      >
        {/* cabeçalho */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#ebe6dd] px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1f1c1a]">
              Relatório
            </h2>
            <p className="mt-0.5 text-xs text-[#8a8278]">
              Resumo de agendamentos por período
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar relatório"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8a8278] transition-colors hover:bg-[#ece7df] hover:text-[#2c2825]"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* seletor de período */}
        <div className="shrink-0 border-b border-[#ebe6dd] px-6 py-3">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                  period === p
                    ? "bg-[#3d6b62] text-white shadow-sm"
                    : "bg-[#ece7df] text-[#5c5348] hover:bg-[#e0d9cf]"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* conteúdo */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <span className="text-4xl">📭</span>
              <p className="text-sm font-medium text-[#8a8278]">
                Sem agendamentos no período selecionado
              </p>
            </div>
          ) : (
            <>
              {/* cards de resumo */}
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#8a8278]">
                  Resumo
                </h3>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <StatCard
                    label="Total"
                    value={stats.total}
                    color="border-[#c5d4d0] bg-[#f4faf8] text-[#2a4d44]"
                  />
                  <StatCard
                    label={statusLabel.scheduled}
                    value={stats.scheduled}
                    color="border-[#c9d4e8] bg-[#f0f5fc] text-[#2e4a63]"
                  />
                  <StatCard
                    label={statusLabel.completed}
                    value={stats.completed}
                    color="border-[#b8d4b0] bg-[#f0faf0] text-[#2a5a22]"
                  />
                  <StatCard
                    label={statusLabel.cancelled}
                    value={stats.cancelled}
                    color="border-[#e8c8c8] bg-[#fdf4f4] text-[#7a2a2a]"
                  />
                </div>
              </section>

              {/* por origem */}
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#8a8278]">
                  Por origem
                </h3>
                <div className="rounded-2xl border border-[#e4ddd3] bg-white/70 p-4 space-y-3">
                  <BarRow
                    label="Painel"
                    count={stats.fromPainel}
                    max={stats.total}
                    colorClass="bg-[#3d6b62]"
                  />
                  <BarRow
                    label="WhatsApp"
                    count={stats.fromWhatsapp}
                    max={stats.total}
                    colorClass="bg-[#25a244]"
                  />
                  {stats.fromOther > 0 && (
                    <BarRow
                      label="Outra origem"
                      count={stats.fromOther}
                      max={stats.total}
                      colorClass="bg-[#8a8278]"
                    />
                  )}
                </div>
              </section>

              {/* por profissional */}
              {stats.byProf.length > 0 && (
                <section>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#8a8278]">
                    Por profissional
                  </h3>
                  <div className="rounded-2xl border border-[#e4ddd3] bg-white/70 p-4 space-y-3">
                    {stats.byProf.map(({ label, count }) => (
                      <BarRow
                        key={label}
                        label={label}
                        count={count}
                        max={maxProf}
                        colorClass="bg-[#5c4d7a]"
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* por procedimento */}
              {stats.byService.length > 0 && (
                <section>
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#8a8278]">
                    Por procedimento
                  </h3>
                  <div className="rounded-2xl border border-[#e4ddd3] bg-white/70 p-4 space-y-3">
                    {stats.byService.slice(0, 8).map(({ label, count }) => (
                      <BarRow
                        key={label}
                        label={label}
                        count={count}
                        max={maxServ}
                        colorClass="bg-[#b87333]"
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
