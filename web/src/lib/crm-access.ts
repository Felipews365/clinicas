/**
 * Regra de acesso ao módulo CRM (alinhada a `public.crm_clinic_has_access` no Supabase).
 * - teste: clínica ativa; se houver data_expiracao, tem de ser >= hoje (UTC); se não houver data, trial com CRM liberado
 * - enterprise (legado) ou plan_tem_crm: clínica ativa, não inadimplente
 * - demais planos: sem acesso
 */
export type ClinicaCrmGate = {
  tipo_plano: string;
  data_expiracao: string | null;
  ativo: boolean;
  inadimplente?: boolean;
  /** Espelho de planos.tem_crm quando há plan_id. */
  plan_tem_crm?: boolean;
};

export function hasFullAccess(clinica: ClinicaCrmGate): boolean {
  if (!clinica.ativo) return false;
  const tipo = String(clinica.tipo_plano || "").toLowerCase();
  const crmByPlan = clinica.plan_tem_crm === true;
  if (tipo === "enterprise" || crmByPlan) {
    return !clinica.inadimplente;
  }
  if (tipo === "teste") {
    const exp = clinica.data_expiracao;
    if (exp == null || String(exp).trim() === "") return true;
    const d = String(exp).slice(0, 10);
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, "0");
    const day = String(today.getUTCDate()).padStart(2, "0");
    const todayStr = `${y}-${m}-${day}`;
    return d >= todayStr;
  }
  return false;
}

export const CRM_PLAN_REQUIRED_RESPONSE = {
  error: "plan_required",
  required_plan: "enterprise",
} as const;
