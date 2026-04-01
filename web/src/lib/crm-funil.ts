/** Valores de `cs_clientes.status_funil` (enum Postgres `crm_status_funil`). */
export const CRM_FUNIL_STATUS = [
  "lead",
  "agendado",
  "atendido",
  "inativo",
  "sumido",
] as const;

export type CrmFunilStatus = (typeof CRM_FUNIL_STATUS)[number];

export function isCrmFunilStatus(s: string): s is CrmFunilStatus {
  return (CRM_FUNIL_STATUS as readonly string[]).includes(s);
}
