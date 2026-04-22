import { parseLocalYmd } from "@/lib/local-day";

/** Grelha fixa 6h–22h (blocos de 1h) para configuração global da clínica. */
export const FULL_CLINIC_AGENDA_HOURS: readonly number[] = [
  6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
];

export const DEFAULT_AGENDA_VISIBLE_HOURS: number[] = [...FULL_CLINIC_AGENDA_HOURS];

/** Manhã + tarde (horário comercial típico): 8–11h e 14–17h. */
export const COMMERCIAL_AGENDA_HOURS: readonly number[] = [
  8, 9, 10, 11, 14, 15, 16, 17,
];

/** Normaliza o array vindo de `clinics.agenda_visible_hours` (Postgres int[]). */
export function normalizeAgendaVisibleHours(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_AGENDA_VISIBLE_HOURS];
  }
  const s = new Set<number>();
  for (const x of raw) {
    const n = typeof x === "number" ? x : Number.parseInt(String(x), 10);
    if (Number.isFinite(n) && n >= 6 && n <= 22) s.add(n);
  }
  if (s.size === 0) return [...DEFAULT_AGENDA_VISIBLE_HOURS];
  return [...s].sort((a, b) => a - b);
}

/** Configuração alinhada a `clinics.agenda_visible_hours` + fim de semana. */
export type ClinicAgendaWeekendConfig = {
  weekdayHours: number[];
  sabadoAberto: boolean;
  /** Horas só de sábado; `null` = quando aberto, usar os mesmos blocos que dias úteis. */
  sabadoAgendaHours: number[] | null;
};

/** Normaliza `clinics.sabado_agenda_hours`; vazio ou inválido → null. */
export function normalizeSabadoAgendaHours(raw: unknown): number[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const s = new Set<number>();
  for (const x of raw) {
    const n = typeof x === "number" ? x : Number.parseInt(String(x), 10);
    if (Number.isFinite(n) && n >= 6 && n <= 22) s.add(n);
  }
  if (s.size === 0) return null;
  return [...s].sort((a, b) => a - b);
}

/**
 * Horas de grade da clínica para uma data (YYYY-MM-DD, calendário local).
 * Domingo → fechado; sábado conforme `sabado_aberto` e `sabado_agenda_hours`.
 */
export function clinicVisibleHoursForDayKey(
  dayKey: string,
  cfg: ClinicAgendaWeekendConfig
): number[] {
  if (!dayKey?.trim()) return [...cfg.weekdayHours];
  const d = parseLocalYmd(dayKey);
  const dow = d.getDay();
  if (dow === 0) return [];
  if (dow === 6) {
    if (!cfg.sabadoAberto) return [];
    if (cfg.sabadoAgendaHours && cfg.sabadoAgendaHours.length > 0) {
      return [...cfg.sabadoAgendaHours];
    }
    return [...cfg.weekdayHours];
  }
  return [...cfg.weekdayHours];
}

export function clinicClosedDayHintPt(
  dayKey: string,
  cfg: ClinicAgendaWeekendConfig
): string | null {
  if (!dayKey?.trim()) return null;
  const d = parseLocalYmd(dayKey);
  const dow = d.getDay();
  if (dow === 0) return "A clínica não atende aos domingos.";
  if (dow === 6 && !cfg.sabadoAberto) {
    return "A clínica está encerrada aos sábados. Pode activar o sábado em «Configurar horários da clínica».";
  }
  return null;
}

export function formatAgendaHourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** Limites para FullCalendar (fim exclusivo). */
export function calendarSlotBoundsFromVisibleHours(hours: number[]): {
  slotMinTime: string;
  slotMaxTime: string;
} {
  const h = normalizeAgendaVisibleHours(hours);
  if (h.length === 0) {
    return { slotMinTime: "06:00:00", slotMaxTime: "23:00:00" };
  }
  const mn = Math.min(...h);
  const mx = Math.max(...h);
  const endH = Math.min(mx + 1, 24);
  return {
    slotMinTime: `${String(mn).padStart(2, "0")}:00:00`,
    slotMaxTime: `${String(endH).padStart(2, "0")}:00:00`,
  };
}
