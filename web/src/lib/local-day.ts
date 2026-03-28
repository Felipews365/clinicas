/** YYYY-MM-DD no fuso local do browser. */
export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function localYmdFromIso(iso: string): string {
  const t = new Date(iso);
  return formatLocalYmd(t);
}

export function matchesLocalDayKey(iso: string, dayKey: string): boolean {
  if (!dayKey) return false;
  return localYmdFromIso(iso) === dayKey;
}

export function parseLocalYmd(dayKey: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDaysToYmd(dayKey: string, delta: number): string {
  const d = parseLocalYmd(dayKey);
  d.setDate(d.getDate() + delta);
  return formatLocalYmd(d);
}

export function isYmdToday(dayKey: string): boolean {
  if (!dayKey) return false;
  return dayKey === formatLocalYmd(new Date());
}

function parseSlotHHMMToMinutes(hhmm: string): number {
  const parts = hhmm.trim().split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

/** Minutos desde meia-noite no fuso local (só hora e minuto). */
export function localMinutesSinceMidnight(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * No dia de hoje, remove vagas cujo horário de início já passou (fuso do browser).
 * Noutros dias devolve a lista sem alterar (inclui dias passados para consulta).
 */
export function filterSlotRowsNotPastToday<T extends { horario: string }>(
  slots: T[],
  dayKey: string
): T[] {
  if (!isYmdToday(dayKey)) return slots;
  const nowM = localMinutesSinceMidnight();
  return slots.filter((s) => parseSlotHHMMToMinutes(s.horario) >= nowM);
}
