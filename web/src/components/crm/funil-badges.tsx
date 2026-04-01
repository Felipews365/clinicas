import type { CrmFunilStatus } from "@/lib/crm-funil";
import { CRM_FUNIL_STATUS } from "@/lib/crm-funil";

const FUNIL_LABEL: Record<CrmFunilStatus, string> = {
  lead: "Lead",
  agendado: "Agendado",
  atendido: "Atendido",
  inativo: "Inactivo",
  sumido: "Sumido",
};

/** Classes para badge do funil (legível em claro / escuro). */
const FUNIL_CLASS: Record<CrmFunilStatus, string> = {
  lead:
    "border border-blue-400/40 bg-blue-500/15 text-blue-800 dark:text-blue-200",
  agendado:
    "border border-amber-400/40 bg-amber-500/15 text-amber-900 dark:text-amber-100",
  atendido:
    "border border-emerald-400/40 bg-emerald-500/15 text-emerald-900 dark:text-emerald-100",
  inativo:
    "border border-orange-400/40 bg-orange-500/15 text-orange-950 dark:text-orange-100",
  sumido:
    "border border-red-400/40 bg-red-500/15 text-red-900 dark:text-red-100",
};

export function normalizeFunil(s: string | undefined | null): CrmFunilStatus {
  const t = String(s ?? "lead").toLowerCase();
  return CRM_FUNIL_STATUS.includes(t as CrmFunilStatus) ? (t as CrmFunilStatus) : "lead";
}

export function FunilBadge({ status }: { status: string | null | undefined }) {
  const k = normalizeFunil(status);
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${FUNIL_CLASS[k]}`}
    >
      {FUNIL_LABEL[k]}
    </span>
  );
}

export function funilLabels(): { value: CrmFunilStatus; label: string }[] {
  return CRM_FUNIL_STATUS.map((value) => ({ value, label: FUNIL_LABEL[value] }));
}
