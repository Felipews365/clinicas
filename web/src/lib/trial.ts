/** Duração padrão do período de teste (plano codigo `teste`) em dias. */
export const TRIAL_DURATION_DAYS = 7;

/** Data local YYYY-MM-DD ao fim do trial a partir de hoje (ou de `from`). */
export function computeTrialExpiryLocalDate(from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + TRIAL_DURATION_DAYS);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
