import { parseLocalYmd } from "@/lib/local-day";

export type SlotsExpedientePresetId =
  | "two_blocks"
  | "morning_full"
  | "extended"
  | "all_together";

export type SlotsExpedientePreset = {
  id: SlotsExpedientePresetId;
  label: string;
  description: string;
  /** Horas cheias (0–23) no «expediente padrão», seg–sex. Ignorado se allTogether. */
  weekday: number[];
  /** Idem para sábado. */
  saturday: number[];
  /** Sem secção «outros horários» — todos os blocos juntos. */
  allTogether?: boolean;
};

export const SLOTS_EXPEDIENTE_PRESETS: readonly SlotsExpedientePreset[] = [
  {
    id: "two_blocks",
    label: "Manhã + tarde (pausa ao almoço)",
    description:
      "Seg–sex: 8h–11h e 14h–17h. Sábado: 8h–11h. Fora disso aparece em «outros horários».",
    weekday: [8, 9, 10, 11, 14, 15, 16, 17],
    saturday: [8, 9, 10, 11],
  },
  {
    id: "morning_full",
    label: "Só manhã contínua",
    description:
      "Seg–sex: 8h–12h. Sábado: 8h–12h. Tarde e noite ficam como «outros».",
    weekday: [8, 9, 10, 11, 12],
    saturday: [8, 9, 10, 11, 12],
  },
  {
    id: "extended",
    label: "Dia longo com almoço",
    description:
      "Seg–sex: 8h–12h e 13h–18h. Sábado: 8h–12h. Noite e madrugada = «outros».",
    weekday: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    saturday: [8, 9, 10, 11, 12],
  },
  {
    id: "all_together",
    label: "Tudo na mesma lista",
    description: "Não separa «outros horários» — todos os blocos do dia em conjunto.",
    weekday: [],
    saturday: [],
    allTogether: true,
  },
] as const;

const PRESET_BY_ID = new Map(
  SLOTS_EXPEDIENTE_PRESETS.map((p) => [p.id, p] as const)
);

/** Valor gravado na coluna `clinics.slots_expediente` (jsonb). */
export function serializeSlotsExpediente(
  preset: SlotsExpedientePresetId
): { preset: SlotsExpedientePresetId } {
  return { preset };
}

export function getSlotsExpedientePreset(id: SlotsExpedientePresetId): SlotsExpedientePreset {
  return PRESET_BY_ID.get(id) ?? SLOTS_EXPEDIENTE_PRESETS[0];
}

export function parseSlotsExpedientePresetId(raw: unknown): SlotsExpedientePresetId {
  let v: unknown = raw;
  if (v == null) return "two_blocks";
  if (typeof v === "string") {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return "two_blocks";
    }
  }
  if (typeof v !== "object" || v === null) return "two_blocks";
  const p = (v as Record<string, unknown>).preset;
  return p === "two_blocks" ||
    p === "morning_full" ||
    p === "extended" ||
    p === "all_together"
    ? p
    : "two_blocks";
}

export function parseSlotHour(horario: string): number {
  const p = horario.trim().split(":");
  const h = Number(p[0]);
  return Number.isFinite(h) ? h : -1;
}

/** Expediente habitual que o painel e o agente assumem: seg–sex manhã + tarde (pausa ao almoço). */
export const AGENT_TEMPLATE_WEEKDAY_HOURS = [8, 9, 10, 11, 14, 15, 16, 17] as const;

/** Sábado: só manhã no mesmo padrão de «bloco» da manhã. */
export const AGENT_TEMPLATE_SATURDAY_HOURS = [8, 9, 10, 11] as const;

/** Verifica se a hora de início do bloco pertence ao quadro habitual listado pelo agente (sem ler presets na base). */
export function isFixedAgentTemplateHour(dayKey: string, hour: number): boolean {
  if (!Number.isFinite(hour) || hour < 0) return false;
  const dow = parseLocalYmd(dayKey).getDay();
  const wk = AGENT_TEMPLATE_WEEKDAY_HOURS as readonly number[];
  const sat = AGENT_TEMPLATE_SATURDAY_HOURS as readonly number[];
  if (dow === 0) return wk.includes(hour);
  if (dow === 6) return sat.includes(hour);
  return wk.includes(hour);
}

/** Entre duas horas de início seguidas no expediente padrão, indica o intervalo «vazio» (ex.: almoço). */
export function mealBreakHourRangeLabel(prevHour: number, nextHour: number): string | null {
  if (!Number.isFinite(prevHour) || !Number.isFinite(nextHour)) return null;
  if (nextHour - prevHour <= 1) return null;
  const a = prevHour + 1;
  const b = nextHour - 1;
  if (a > b) return null;
  if (a === b) return `${a}h`;
  return `${a}h–${b}h`;
}

export function isStandardExpedienteHour(
  dayKey: string,
  hour: number,
  rawExpediente: unknown
): boolean {
  if (hour < 0) return false;
  const preset = getSlotsExpedientePreset(parseSlotsExpedientePresetId(rawExpediente));
  if (preset.allTogether) return true;
  const dow = parseLocalYmd(dayKey).getDay();
  // Domingo: usar o mesmo quadro que seg–sex (evita tudo cair em «outros» sem modelo para domingo).
  if (dow === 0) return preset.weekday.includes(hour);
  if (dow === 6) return preset.saturday.includes(hour);
  return preset.weekday.includes(hour);
}

export function partitionSlotsByExpedienteModel<T extends { horario: string }>(
  dayKey: string,
  slots: T[],
  rawExpediente: unknown
): { standard: T[]; extra: T[] } {
  const standard: T[] = [];
  const extra: T[] = [];
  for (const s of slots) {
    const h = parseSlotHour(s.horario);
    if (isStandardExpedienteHour(dayKey, h, rawExpediente)) {
      standard.push(s);
    } else {
      extra.push(s);
    }
  }
  const byTime = (a: T, b: T) => parseSlotHour(a.horario) - parseSlotHour(b.horario);
  standard.sort(byTime);
  extra.sort(byTime);
  return { standard, extra };
}
