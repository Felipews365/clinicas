"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { AppointmentCardList } from "@/components/appointment-card-list";
import { AppointmentsCalendar } from "@/components/appointments-calendar";
import { useAnimatedNumber } from "@/hooks/use-animated-number";
import {
  addDaysToYmd,
  isYmdToday,
  matchesLocalDayKey,
  parseLocalYmd,
} from "@/lib/local-day";
import { resolveProfessionalCardStyle } from "@/lib/professional-palette";
import type { PainelCsSlotRow, PainelDashboardRpc } from "@/types/painel-dashboard";
import {
  type AppointmentRow,
  one,
} from "@/types/appointments";

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] as const;

function rowProfessionalId(r: AppointmentRow): string | null {
  const raw = one(r.professionals)?.id;
  if (raw == null || raw === "") return null;
  return String(raw);
}

function normalizeProfessionalName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function rowMatchesProfessionalFilter(
  r: AppointmentRow,
  profFilterId: string,
  roster: readonly { id: string; name: string }[]
): boolean {
  if (rowProfessionalId(r) === profFilterId) return true;
  const entry = roster.find((p) => p.id === profFilterId);
  if (!entry) return false;
  const embedName = one(r.professionals)?.name ?? "";
  if (!embedName.trim()) return false;
  return (
    normalizeProfessionalName(embedName) ===
    normalizeProfessionalName(entry.name)
  );
}

function overlapsLocalHour(
  isoStart: string,
  isoEnd: string,
  dayKey: string,
  hour: number
): boolean {
  const start = new Date(isoStart);
  const end = new Date(isoEnd);
  const day = parseLocalYmd(dayKey);
  const slotStart = new Date(day);
  slotStart.setHours(hour, 0, 0, 0);
  const slotEnd = new Date(day);
  slotEnd.setHours(hour + 1, 0, 0, 0);
  return start < slotEnd && end > slotStart;
}

function nowInLocalHour(dayKey: string, hour: number): boolean {
  const now = new Date();
  const day = parseLocalYmd(dayKey);
  const slotStart = new Date(day);
  slotStart.setHours(hour, 0, 0, 0);
  const slotEnd = new Date(day);
  slotEnd.setHours(hour + 1, 0, 0, 0);
  return now >= slotStart && now < slotEnd;
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

function DeltaRow({
  current,
  previous,
  suffix = "",
  invert = false,
}: {
  current: number;
  previous: number;
  suffix?: string;
  invert?: boolean;
}) {
  if (previous === 0 && current === 0) {
    return (
      <p className="mt-2 text-xs text-[var(--text-muted)]">Sem mês anterior</p>
    );
  }
  if (previous === 0) {
    return (
      <p className="mt-2 text-xs font-medium text-emerald-500">Novo período</p>
    );
  }
  const diff = ((current - previous) / Math.abs(previous)) * 100;
  const good = invert ? diff <= 0 : diff >= 0;
  const arrow = diff >= 0 ? "↑" : "↓";
  const color = good ? "text-emerald-500" : "text-red-400";
  return (
    <p className={`mt-2 flex items-center gap-1 text-xs font-medium ${color}`}>
      <span aria-hidden>{arrow}</span>
      {Math.abs(diff).toFixed(1)}% vs mês anterior
      {suffix ? ` ${suffix}` : ""}
    </p>
  );
}

function DayDelta({
  label,
  cur,
  prev,
}: {
  label: string;
  cur: number;
  prev: number;
}) {
  const d = cur - prev;
  if (d === 0) {
    return (
      <span className="text-xs text-[var(--text-muted)]">Igual a ontem</span>
    );
  }
  const up = d > 0;
  const color = up ? "text-emerald-500" : "text-red-400";
  return (
    <span className={`text-xs font-medium ${color}`}>
      {up ? "↑" : "↓"} {Math.abs(d)} {label} vs ontem
    </span>
  );
}

function RingMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 36;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-24 w-24">
        <svg className="-rotate-90 transform" viewBox="0 0 100 100" aria-hidden>
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            className="stroke-[var(--border)]"
            strokeWidth="10"
          />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={off}
            className="transition-[stroke-dashoffset] duration-700 ease-out"
            style={{ stroke: color }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold tabular-nums text-[var(--text)]">
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>
      <p className="max-w-[100px] text-center text-[11px] font-medium text-[var(--text-muted)]">
        {label}
      </p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-full max-w-4xl rounded-lg bg-[var(--surface-soft)]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-2xl bg-[var(--surface-soft)]"
          />
        ))}
      </div>
      <div className="h-40 rounded-2xl bg-[var(--surface-soft)]" />
      <div className="h-64 rounded-2xl bg-[var(--surface-soft)]" />
    </div>
  );
}

function AgendaListSkeletonBlock() {
  return (
    <div className="flex flex-col gap-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-28 rounded-2xl bg-[var(--surface-soft)] animate-pulse"
        />
      ))}
    </div>
  );
}

type ProfRosterEntry = {
  id: string;
  name: string;
  panel_color: string | null;
  cs_profissional_id?: string | null;
};

export type PainelDashboardProps = {
  clinicId: string;
  supabase: SupabaseClient;
  /** Lista completa (merge) para detectar carregamento inicial vazio. */
  rows: AppointmentRow[];
  listLoading: boolean;
  listError: string | null;
  listFilter: "all" | "pending" | "confirmed";
  setListFilter: Dispatch<SetStateAction<"all" | "pending" | "confirmed">>;
  profFilterId: string | null;
  setProfFilterId: Dispatch<SetStateAction<string | null>>;
  profRoster: ProfRosterEntry[];
  viewMode: "list" | "calendar" | "grid";
  setViewMode: Dispatch<SetStateAction<"list" | "calendar" | "grid">>;
  dayKey: string;
  setDayKey: Dispatch<SetStateAction<string>>;
  todayLabel: string;
  setTodayLabel: Dispatch<SetStateAction<string>>;
  selectedDayLabel: string;
  stats: {
    totalScheduled: number;
    pending: number;
    confirmedOnDay: number;
  };
  statsYesterday: {
    totalScheduled: number;
    pending: number;
    confirmedOnDay: number;
  };
  loadAppointments: () => Promise<void>;
  calendarFocusDate?: Date;
  calendarSlotBounds: { slotMinTime: string; slotMaxTime: string };
  listDisplayRows: AppointmentRow[];
  profFilteredRows: AppointmentRow[];
  rowBusy: string | null;
  onConfirmAppointment: (id: string) => void;
  onRemoveAppointment: (id: string) => void;
  filterActive: string;
  filterIdle: string;
  viewToggleActive: string;
  viewToggleIdle: string;
};

export function PainelDashboard({
  clinicId,
  supabase,
  rows,
  listLoading,
  listError,
  listFilter,
  setListFilter,
  profFilterId,
  setProfFilterId,
  profRoster,
  viewMode,
  setViewMode,
  dayKey,
  setDayKey,
  todayLabel,
  setTodayLabel,
  selectedDayLabel,
  stats,
  statsYesterday,
  loadAppointments,
  calendarFocusDate,
  calendarSlotBounds,
  listDisplayRows,
  profFilteredRows,
  rowBusy,
  onConfirmAppointment,
  onRemoveAppointment,
  filterActive,
  filterIdle,
  viewToggleActive,
  viewToggleIdle,
}: PainelDashboardProps) {
  const router = useRouter();
  const [nowTick, setNowTick] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: kpiData, isLoading: kpiLoading } = useQuery({
    queryKey: ["painel_dashboard_kpis", clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("painel_dashboard_kpis", {
        p_clinic_id: clinicId,
      });
      if (error) throw error;
      return data as PainelDashboardRpc;
    },
    enabled: !!clinicId,
  });

  const { data: slotsRaw = [], dataUpdatedAt } = useQuery({
    queryKey: ["painel_cs_slots_dia", clinicId, dayKey],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("painel_cs_slots_dia", {
        p_clinic_id: clinicId,
        p_data: dayKey,
      });
      if (error) return [] as PainelCsSlotRow[];
      const parsed = data as unknown;
      if (Array.isArray(parsed)) return parsed as PainelCsSlotRow[];
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { body?: unknown }).body)) {
        return (parsed as { body: PainelCsSlotRow[] }).body;
      }
      return [] as PainelCsSlotRow[];
    },
    enabled: !!clinicId && !!dayKey,
    refetchInterval: 5 * 60 * 1000,
  });

  const slotLookup = useMemo(() => {
    const m = new Map<string, PainelCsSlotRow[]>();
    for (const s of slotsRaw) {
      const panelId =
        profRoster.find((p) => p.cs_profissional_id === s.profissional_id)
          ?.id ?? "";
      if (!panelId) continue;
      if (!m.has(panelId)) m.set(panelId, []);
      m.get(panelId)!.push(s);
    }
    return m;
  }, [slotsRaw, profRoster]);

  const dayRowsForGrid = useMemo(() => {
    return profFilteredRows.filter(
      (r) =>
        r.status !== "cancelled" &&
        (dayKey ? matchesLocalDayKey(r.starts_at, dayKey) : true)
    );
  }, [profFilteredRows, dayKey]);

  type CellState = "livre" | "agendado" | "curso" | "bloqueado";

  const gridCell = useCallback(
    (profId: string, hour: number): CellState => {
      const ap = dayRowsForGrid.find(
        (r) =>
          rowMatchesProfessionalFilter(r, profId, profRoster) &&
          overlapsLocalHour(r.starts_at, r.ends_at, dayKey, hour)
      );
      const slotList = slotLookup.get(profId) ?? [];
      const slot = slotList.find(
        (s) =>
          parseInt(String(s.horario).split(":")[0] ?? "0", 10) === hour
      );
      if (slot?.bloqueio_manual) return "bloqueado";
      if (ap) {
        if (nowInLocalHour(dayKey, hour)) return "curso";
        return "agendado";
      }
      if (slot && slot.disponivel === false && !slot.bloqueio_manual) {
        return "agendado";
      }
      return "livre";
    },
    [dayRowsForGrid, dayKey, profRoster, slotLookup]
  );

  const meta = kpiData?.meta;
  const month = kpiData?.month;
  const insights = kpiData?.insights;
  const topServices = kpiData?.top_services ?? [];

  const animRev = useAnimatedNumber(month?.revenue ?? 0);
  const animNew = useAnimatedNumber(month?.new_patients ?? 0);
  const animConf = useAnimatedNumber(month?.confirmation_rate ?? 0);
  const animOcc = useAnimatedNumber(month?.occupancy_today_pct ?? 0);
  const animDayTotal = useAnimatedNumber(stats.totalScheduled);
  const animDayPend = useAnimatedNumber(stats.pending);
  const animDayConf = useAnimatedNumber(stats.confirmedOnDay);

  const maxTop = useMemo(
    () => Math.max(1, ...topServices.map((s) => s.count)),
    [topServices]
  );

  const profFilterAsSelect = profRoster.length >= 5;
  const profFilterSelectValue =
    profFilterId &&
    profRoster.some((p) => p.id === profFilterId)
      ? profFilterId
      : "__all__";

  return (
    <>
      {/* Appointment INSERT toasts */}
      <AppointmentInsertToasts
        clinicId={clinicId}
        supabase={supabase}
        loadAppointments={loadAppointments}
      />

      <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-[var(--border)] bg-[var(--bg)]/95 px-4 py-2 backdrop-blur-sm sm:-mx-7 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              Sistema online
            </span>
            <span className="hidden sm:inline">|</span>
            <span>
              Profissionais activos:{" "}
              <strong className="text-[var(--text)]">
                {meta?.professionals_active ?? profRoster.length}
              </strong>
            </span>
            {meta?.ia_active ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/15 px-2 py-0.5 text-[11px] font-semibold text-teal-400">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                IA activa
              </span>
            ) : (
              <span className="text-[11px] text-[var(--text-muted)]">
                IA inactiva
              </span>
            )}
          </div>
          <time className="tabular-nums text-[var(--text)]" dateTime={nowTick.toISOString()}>
            {new Intl.DateTimeFormat("pt-BR", {
              weekday: "short",
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }).format(nowTick)}
          </time>
        </div>
      </div>

      {kpiLoading && !kpiData ? (
        <DashboardSkeleton />
      ) : null}

      {kpiData ? (
        <>
          <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Receita projectada (mês)
              </p>
              <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-[var(--primary)]">
                {formatBRL(animRev)}
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Confirmados × preço (estimativa)
              </p>
              <DeltaRow
                current={month!.revenue}
                previous={month!.revenue_prev}
              />
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Novos pacientes
              </p>
              <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-[var(--primary)]">
                {Math.round(animNew)}
              </p>
              <DeltaRow
                current={month!.new_patients}
                previous={month!.new_patients_prev}
              />
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Taxa confirmação
              </p>
              <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-[var(--primary)]">
                {animConf.toFixed(1)}%
              </p>
              <DeltaRow
                current={month!.confirmation_rate}
                previous={month!.confirmation_rate_prev}
              />
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Ocupação hoje
              </p>
              <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-teal-400">
                {animOcc.toFixed(1)}%
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Horas reservadas / capacidade 07h–19h
              </p>
            </div>
          </div>

          <div className="mb-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Insights
            </p>
            <div className="mt-4 flex flex-wrap justify-around gap-6 sm:justify-between">
              <RingMetric
                label="Confirmação"
                value={insights!.confirmation_pct}
                color="var(--primary)"
              />
              <RingMetric
                label="Retorno (90d)"
                value={insights!.return_pct}
                color="#2dd4bf"
              />
              <RingMetric
                label="Ocupação"
                value={insights!.occupancy_pct}
                color="#34d399"
              />
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-[var(--surface-soft)] p-4">
                <p className="text-sm font-semibold text-[var(--text)]">
                  Retorno vencido
                </p>
                <p className="mt-1 text-2xl font-bold text-amber-400">
                  {insights!.alerts.retorno_vencido_count}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Sem consulta há 180d+ (não sumidos)
                </p>
                <button
                  type="button"
                  className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-white"
                  onClick={() =>
                    router.push(`/clinica/${encodeURIComponent(clinicId)}/crm`)
                  }
                >
                  Ver no CRM
                </button>
              </div>
              <div className="rounded-xl bg-[var(--surface-soft)] p-4">
                <p className="text-sm font-semibold text-[var(--text)]">
                  Receita represada
                </p>
                <p className="mt-1 text-2xl font-bold text-orange-400">
                  {formatBRL(insights!.alerts.receita_represada)}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Pendentes de confirmação (mês)
                </p>
              </div>
              <div className="rounded-xl bg-[var(--surface-soft)] p-4">
                <p className="text-sm font-semibold text-[var(--text)]">
                  Agenda com buracos
                </p>
                <p className="mt-1 text-2xl font-bold text-teal-400">
                  {insights!.alerts.agenda_buracos_count}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Horas livres entre marcações (hoje)
                </p>
              </div>
            </div>
          </div>

          {topServices.length > 0 ? (
            <div className="mb-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Serviços do mês
              </p>
              <ul className="mt-4 space-y-3">
                {topServices.map((s, idx) => {
                  const hue = (idx * 47) % 360;
                  const w = (s.count / maxTop) * 100;
                  return (
                    <li key={s.name} className="min-w-0">
                      <div className="flex justify-between text-sm">
                        <span className="truncate font-medium text-[var(--text)]">
                          {s.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-[var(--text-muted)]">
                          {s.count} · {formatBRL(Number(s.revenue))}
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--surface-soft)]">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${w}%`,
                            background: `hsl(${hue} 65% 45%)`,
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="agenda-animate-in max-w-xl" style={{ animationDelay: "0ms" }}>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--primary)]">
            Dashboard
          </p>
          <h1 className="mt-2 font-bold text-3xl text-[var(--text)] sm:text-4xl">
            Agenda do dia
          </h1>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-[var(--text-muted)]">
            <span className="capitalize">{selectedDayLabel}</span>
            {dayKey && !isYmdToday(dayKey) && todayLabel ? (
              <span className="mt-1 block text-sm font-normal normal-case text-[var(--text-muted)]">
                Referência de hoje: {todayLabel}
              </span>
            ) : null}
          </p>
        </div>
        <div
          className="agenda-animate-in flex flex-wrap items-center gap-2 sm:justify-end"
          style={{ animationDelay: "45ms" }}
          role="tablist"
          aria-label="Filtrar por estado"
        >
          {(
            [
              ["all", "Todos"],
              ["pending", "Pendentes"],
              ["confirmed", "Confirmados"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={listFilter === value}
              onClick={() => setListFilter(value)}
              className={listFilter === value ? filterActive : filterIdle}
            >
              {label}
              {value === "pending" && stats.pending > 0 ? (
                <span
                  className={`ml-1.5 inline-flex min-h-[1.25rem] min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                    listFilter === "pending"
                      ? "bg-white/20 text-white"
                      : "bg-[#fff0e6] text-[#b45309]"
                  }`}
                >
                  {stats.pending > 99 ? "99+" : stats.pending}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div
        className="agenda-animate-in mb-8 flex flex-col gap-2"
        style={{ animationDelay: "28ms" }}
      >
        {profFilterAsSelect ? (
          <label
            htmlFor="painel-prof-filter"
            className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
          >
            Profissional
          </label>
        ) : (
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Profissional
          </p>
        )}
        {profFilterAsSelect ? (
          <select
            id="painel-prof-filter"
            aria-label="Filtrar por profissional"
            value={profFilterSelectValue}
            onChange={(e) => {
              const v = e.target.value;
              setProfFilterId(v === "__all__" ? null : v);
            }}
            className="w-full max-w-md min-w-[12rem] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-sans text-sm font-medium text-[var(--text)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            <option value="__all__">Todos</option>
            {profRoster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <div
            className="flex flex-wrap gap-2"
            role="tablist"
            aria-label="Filtrar por profissional"
          >
            <button
              type="button"
              role="tab"
              aria-selected={profFilterId === null}
              onClick={() => setProfFilterId(null)}
              className={
                profFilterId === null
                  ? "rounded-full bg-[var(--primary)] px-4 py-2 text-xs font-semibold text-white shadow-sm"
                  : "rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs font-medium text-[var(--text-muted)] shadow-sm transition-colors hover:bg-[var(--surface-soft)]"
              }
            >
              Todos
            </button>
            {profRoster.map((p) => {
              const accent = resolveProfessionalCardStyle(
                p.panel_color,
                p.id
              ).accent;
              const sel = profFilterId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={sel}
                  onClick={() => setProfFilterId(p.id)}
                  className={
                    sel
                      ? "inline-flex items-center gap-2 rounded-full bg-[var(--primary)] pl-2 pr-4 py-2 text-xs font-semibold text-white shadow-sm"
                      : "inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] pl-2 pr-4 py-2 text-xs font-medium text-[var(--text-muted)] shadow-sm transition-colors hover:bg-[var(--surface-soft)]"
                  }
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--text)]/15 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]"
                    style={{ backgroundColor: accent }}
                    aria-hidden
                  />
                  <span className="max-w-[200px] truncate">{p.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="agenda-animate-in mb-8 flex flex-col gap-4 rounded-2xl bg-[var(--surface)] shadow-sm p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!dayKey}
            onClick={() => dayKey && setDayKey((k) => addDaysToYmd(k, -1))}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-semibold text-[var(--text-muted)] shadow-sm transition-colors hover:bg-[var(--surface-soft)]"
          >
            Dia anterior
          </button>
          <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <span className="sr-only sm:not-sr-only">Data</span>
            <input
              type="date"
              disabled={!dayKey}
              value={dayKey}
              onChange={(e) => {
                const v = e.target.value;
                if (v) setDayKey(v);
              }}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-sans text-[var(--text)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-50"
            />
          </label>
          <button
            type="button"
            disabled={!dayKey}
            onClick={() => dayKey && setDayKey((k) => addDaysToYmd(k, 1))}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-semibold text-[var(--text-muted)] shadow-sm transition-colors hover:bg-[var(--surface-soft)]"
          >
            Próximo dia
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setDayKey(
                `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
              );
              setTodayLabel(
                new Intl.DateTimeFormat("pt-BR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                }).format(now)
              );
            }}
            disabled={!dayKey || isYmdToday(dayKey)}
            className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--primary-strong)] disabled:opacity-40"
          >
            Ir para hoje
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-1"
            role="group"
            aria-label="Vista"
          >
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={
                viewMode === "list" ? viewToggleActive : viewToggleIdle
              }
            >
              Lista
            </button>
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={
                viewMode === "calendar" ? viewToggleActive : viewToggleIdle
              }
            >
              Calendário
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={
                viewMode === "grid" ? viewToggleActive : viewToggleIdle
              }
            >
              Grade
            </button>
          </div>
          <button
            type="button"
            disabled={listLoading}
            onClick={() => void loadAppointments()}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text-muted)] shadow-sm transition-colors hover:bg-[var(--surface-soft)] disabled:opacity-50"
          >
            Atualizar dados
          </button>
        </div>
      </div>

      <div
        className="mb-10 grid gap-4 sm:grid-cols-3"
        aria-label="Resumo numérico do dia animate"
      >
        <div className="agenda-animate-in rounded-2xl bg-[var(--surface)] shadow-sm px-6 py-5">
          <p className="font-display text-4xl font-semibold tabular-nums text-[var(--primary)]">
            {Math.round(animDayTotal)}
          </p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            No dia
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Consultas agendadas</p>
          <div className="mt-2">
            <DayDelta
              label="marc."
              cur={stats.totalScheduled}
              prev={statsYesterday.totalScheduled}
            />
          </div>
        </div>
        <div
          className="agenda-animate-in rounded-2xl bg-[var(--surface)] shadow-sm px-6 py-5"
          style={{ animationDelay: "60ms" }}
        >
          <p className="font-display text-4xl font-semibold tabular-nums text-[#dc6526]">
            {Math.round(animDayPend)}
          </p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Pendentes
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Inclui marcações via WhatsApp
          </p>
          <div className="mt-2">
            <DayDelta
              label="pend."
              cur={stats.pending}
              prev={statsYesterday.pending}
            />
          </div>
        </div>
        <div
          className="agenda-animate-in rounded-2xl bg-[var(--surface)] shadow-sm px-6 py-5"
          style={{ animationDelay: "120ms" }}
        >
          <p className="font-display text-4xl font-semibold tabular-nums text-[var(--primary)]">
            {Math.round(animDayConf)}
          </p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Confirmados
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Validados no painel
          </p>
          <div className="mt-2">
            <DayDelta
              label="conf."
              cur={stats.confirmedOnDay}
              prev={statsYesterday.confirmedOnDay}
            />
          </div>
        </div>
      </div>

      {viewMode === "grid" && dayKey ? (
        <div className="mb-8 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Grade do dia (07h–19h) · actualizado{" "}
            {dataUpdatedAt
              ? new Date(dataUpdatedAt).toLocaleTimeString("pt-BR")
              : "—"}
          </p>
          <div className="flex min-w-max gap-1 text-[10px] text-[var(--text-muted)]">
            <div className="w-24 shrink-0" />
            {HOURS.map((h) => (
              <div key={h} className="w-10 shrink-0 text-center font-medium">
                {h}h
              </div>
            ))}
          </div>
          {profRoster.map((p) => {
            const accent = resolveProfessionalCardStyle(
              p.panel_color,
              p.id
            ).accent;
            return (
              <div key={p.id} className="flex min-w-max items-stretch gap-1 py-0.5">
                <div
                  className="flex w-24 shrink-0 items-center gap-1 truncate pr-2 text-xs font-medium text-[var(--text)]"
                  title={p.name}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                  <span className="truncate">{p.name}</span>
                </div>
                {HOURS.map((h) => {
                  const st = gridCell(p.id, h);
                  const bg =
                    st === "agendado"
                      ? "bg-teal-600/80"
                      : st === "curso"
                        ? "bg-orange-500/90"
                        : st === "bloqueado"
                          ? "bg-red-600/85"
                          : "bg-emerald-600/35";
                  const title =
                    st === "agendado"
                      ? "Agendado"
                      : st === "curso"
                        ? "Em curso"
                        : st === "bloqueado"
                          ? "Bloqueado"
                          : "Livre";
                  return (
                    <div
                      key={h}
                      title={title}
                      className={`h-8 w-10 shrink-0 rounded-md border border-[var(--border)]/40 ${bg}`}
                    />
                  );
                })}
              </div>
            );
          })}
          <p className="mt-3 text-[10px] text-[var(--text-muted)]">
            Legenda: teal agendado · verde livre · laranja em curso · vermelho bloqueado
          </p>
        </div>
      ) : null}

      {listError ? (
        <p
          className="agenda-animate-in mb-6 rounded-2xl border border-red-200/90 bg-red-50/95 px-4 py-3.5 text-sm leading-relaxed text-red-900 shadow-sm dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-100"
          role="alert"
        >
          {listError}
        </p>
      ) : null}

      {kpiLoading && !kpiData ? null : viewMode === "calendar" ? (
        <div className={listLoading && !profFilteredRows.length ? "min-h-[200px]" : ""}>
          {listLoading && !profFilteredRows.length ? (
            <p className="py-16 text-center text-sm text-[var(--text-muted)]">
              A carregar calendário…
            </p>
          ) : (
            <AppointmentsCalendar
              rows={profFilteredRows}
              loading={listLoading}
              focusDate={calendarFocusDate}
              slotMinTime={calendarSlotBounds.slotMinTime}
              slotMaxTime={calendarSlotBounds.slotMaxTime}
            />
          )}
        </div>
      ) : viewMode === "list" && listLoading && !rows.length ? (
        <AgendaListSkeletonBlock />
      ) : viewMode === "list" && listDisplayRows.length === 0 ? (
        <div className="agenda-animate-in rounded-[1.35rem] border border-[var(--border)] bg-[var(--surface)] px-8 py-14 text-center shadow-[var(--shadow-card)]">
          <p className="font-display text-xl font-semibold text-[var(--text)]">
            {profFilteredRows.length === 0
              ? "Nenhum agendamento neste filtro"
              : "Nenhum agendamento neste dia"}
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
            Ajuste filtros ou navegue para outro dia.
          </p>
        </div>
      ) : viewMode === "list" ? (
        <AppointmentCardList
          rows={listDisplayRows}
          busyId={rowBusy}
          onConfirm={onConfirmAppointment}
          onRemove={onRemoveAppointment}
        />
      ) : null}
    </>
  );
}

function AppointmentInsertToasts({
  clinicId,
  supabase,
  loadAppointments,
}: {
  clinicId: string;
  supabase: SupabaseClient;
  loadAppointments: () => Promise<void>;
}) {
  const [toasts, setToasts] = useState<
    { id: string; title: string; body: string; created: number }[]
  >([]);

  useEffect(() => {
    const ch = supabase
      .channel(`painel-insert-toast:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "appointments",
          filter: `clinic_id=eq.${clinicId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string;
            patient_id?: string;
            service_name?: string | null;
            starts_at?: string;
            source?: string | null;
          };
          if (row.source === "painel") {
            void loadAppointments();
            return;
          }
          let patient = "Paciente";
          let svc = row.service_name?.trim() || "Serviço";
          if (row.patient_id) {
            const { data } = await supabase
              .from("patients")
              .select("name")
              .eq("id", row.patient_id)
              .maybeSingle();
            if (data?.name) patient = data.name;
          }
          const t =
            row.starts_at &&
            new Intl.DateTimeFormat("pt-BR", {
              weekday: "short",
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(row.starts_at));
          const id = `${row.id}-${Date.now()}`;
          setToasts((prev) => [
            ...prev,
            {
              id,
              title: "Novo agendamento",
              body: `${patient} · ${svc} · ${t ?? ""}`,
              created: Date.now(),
            },
          ]);
          window.setTimeout(() => {
            setToasts((prev) => prev.filter((x) => x.id !== id));
          }, 5000);
          void loadAppointments();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [clinicId, supabase, loadAppointments]);

  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed top-16 right-4 z-[95] flex max-w-sm flex-col gap-2 sm:top-20 sm:right-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className="pointer-events-auto animate-in slide-in-from-right-3 fade-in duration-300 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl"
        >
          <p className="text-sm font-semibold text-[var(--text)]">{t.title}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t.body}</p>
        </div>
      ))}
    </div>
  );
}
