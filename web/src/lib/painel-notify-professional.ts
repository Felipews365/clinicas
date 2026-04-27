import type { AppointmentRow } from "@/types/appointments";
import { one } from "@/types/appointments";
import {
  formatDateBrFromIso,
  formatDateBrFromYmd,
  formatHoraBr,
  formatHoraBrFromIso,
  normalizeProfissionalGenero,
  profWhatsAppCancelamento,
  profWhatsAppNovoAgendamento,
  profWhatsAppReagendamento,
  type ProfissionalGenero,
} from "@/lib/professional-notify-message";

/** Resposta estendida de painel_cancel_cs_agendamento após migration notify. */
export type PainelCancelCsResult = {
  ok?: boolean;
  error?: string;
  profissional_whatsapp?: string | null;
  profissional_nome?: string | null;
  profissional_genero?: string | null;
  nome_cliente?: string | null;
  cliente_telefone?: string | null;
  nome_procedimento?: string | null;
  data_agendamento?: string | null;
  horario?: string | null;
};

/** A RPC devolve JSON com ok:false sem falha HTTP — o cliente Supabase não preenche `error`. */
export function painelRpcCancelCsErrorMessage(data: unknown): string | null {
  const o = data as PainelCancelCsResult | null;
  if (o?.ok === true) return null;
  if (o?.ok === false) {
    if (o.error === "not_found") {
      return "Agendamento não encontrado ou sem permissão nesta clínica.";
    }
    if (o.error === "already_cancelled") {
      return "Este agendamento já estava cancelado.";
    }
    return "Não foi possível cancelar o agendamento.";
  }
  if (data == null || typeof data !== "object") {
    return "Resposta inválida ao cancelar.";
  }
  return "Não foi possível cancelar o agendamento.";
}

/** Id do painel para linhas de `cs_agendamentos` (prefixo cs:, case-insensitive). */
export function isPanelCsAgendamentoId(id: string): boolean {
  return /^cs:/i.test(id.trim());
}

/** UUID em `p_cs_agendamento_id` a partir do id mostrado no painel. */
export function csAgendamentoUuidFromPanelId(id: string): string | null {
  const m = /^cs:(.+)$/i.exec(id.trim());
  const u = m?.[1]?.trim();
  return u || null;
}

export function buildPainelCancelWhatsAppText(p: {
  profissional_nome?: string | null;
  profissional_genero?: string | null;
  nome_cliente?: string | null;
  cliente_telefone?: string | null;
  nome_procedimento?: string | null;
  data_agendamento?: string | null;
  horario?: string | null;
}): string {
  const nome = (p.nome_cliente || "Cliente").trim();
  const serv = (p.nome_procedimento || "Consulta").trim();
  const dRaw =
    typeof p.data_agendamento === "string"
      ? p.data_agendamento
      : p.data_agendamento != null
        ? String(p.data_agendamento)
        : "";
  return profWhatsAppCancelamento({
    profissional: p.profissional_nome?.trim() || null,
    profissionalGenero: normalizeProfissionalGenero(p.profissional_genero),
    cliente: nome,
    clienteTelefone: p.cliente_telefone?.trim() || null,
    servico: serv,
    data: formatDateBrFromYmd(dRaw),
    hora: formatHoraBr(p.horario),
  });
}

/** Evita segundo aviso de cancelamento quando o painel já enviou após `painel_cancel_cs_agendamento`. */
const skipDuplicateCancelProfNotifyIds = new Set<string>();

function consumeSkipDuplicateCancelProfNotify(appointmentPanelId: string): boolean {
  const id = appointmentPanelId.trim();
  if (!skipDuplicateCancelProfNotifyIds.has(id)) return false;
  skipDuplicateCancelProfNotifyIds.delete(id);
  return true;
}

const AGENDA_PROF_NOTIFY_DEDUPE_MS = 120_000;
const agendaProfNotifyDedupe = new Map<string, number>();

function agendaProfNotifyDedupeShouldSkip(
  clinicId: string,
  appointmentId: string,
  kind: string
): boolean {
  const k = `${clinicId}\n${appointmentId}\n${kind}`;
  const t = Date.now();
  const prev = agendaProfNotifyDedupe.get(k);
  if (prev != null && t - prev < AGENDA_PROF_NOTIFY_DEDUPE_MS) return true;
  agendaProfNotifyDedupe.set(k, t);
  if (agendaProfNotifyDedupe.size > 120) {
    for (const [key, ts] of agendaProfNotifyDedupe) {
      if (t - ts >= AGENDA_PROF_NOTIFY_DEDUPE_MS) agendaProfNotifyDedupe.delete(key);
    }
  }
  return false;
}

function normProfNameForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(dra?|dr)\.?\s+/i, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type ProfRosterWhatsappEntry = {
  id: string;
  name: string;
  gender?: string | null;
  cs_profissional_id: string | null;
  whatsapp: string | null;
};

export function resolveProfessionalWhatsappFromRoster(
  row: AppointmentRow,
  roster: readonly ProfRosterWhatsappEntry[]
): string | null {
  const prof = one(row.professionals);
  if (!prof) return null;
  const pid = prof.id != null && String(prof.id).trim() !== "" ? String(prof.id) : null;
  if (pid) {
    const hit = roster.find((p) => p.id === pid);
    const w = hit?.whatsapp?.trim();
    if (w) return w;
  }
  const want = normProfNameForMatch(prof.name || "");
  if (!want) return null;
  const byName = roster.find(
    (p) => normProfNameForMatch(p.name) === want && p.whatsapp?.trim()
  );
  return byName?.whatsapp?.trim() ?? null;
}

/**
 * Quando o painel mostra o mesmo evento que o sininho (novo / reagendamento / cancelamento),
 * avisa o WhatsApp do profissional. Complementa o n8n (regex / Evolution) com o mesmo Evolution
 * do route `/api/whatsapp/notify-professional`, enquanto alguém com a agenda aberta.
 */
export function fireNotifyProfessionalFromAgendaDiff(params: {
  clinicId: string;
  row: AppointmentRow;
  kind: "agendamento" | "cancelamento" | "reagendamento";
  roster: readonly ProfRosterWhatsappEntry[];
  prevStartsAt?: string;
}): void {
  const { clinicId, row, kind, roster } = params;

  if (kind === "cancelamento" && consumeSkipDuplicateCancelProfNotify(row.id)) {
    return;
  }

  if (kind === "agendamento" && row.source === "painel") {
    return;
  }

  if (agendaProfNotifyDedupeShouldSkip(clinicId, row.id, kind)) return;

  const phone = resolveProfessionalWhatsappFromRoster(row, roster);
  if (!phone) return;

  const pat = one(row.patients);
  const patient = pat?.name?.trim() || "Cliente";
  const patientPhone = pat?.phone?.trim() || null;
  const serv = (row.service_name || "Consulta").trim();
  const prof = one(row.professionals);
  const profNome = prof?.name?.trim() || null;
  let profGenero: ProfissionalGenero = normalizeProfissionalGenero(prof?.gender);
  if (profGenero == null && prof?.id) {
    const pid = String(prof.id).trim();
    const hit = roster.find((p) => p.id === pid);
    profGenero = normalizeProfissionalGenero(hit?.gender);
  }

  let text: string;
  if (kind === "agendamento") {
    text = profWhatsAppNovoAgendamento({
      profissional: profNome,
      profissionalGenero: profGenero,
      cliente: patient,
      clienteTelefone: patientPhone,
      servico: serv,
      data: formatDateBrFromIso(row.starts_at),
      hora: formatHoraBrFromIso(row.starts_at),
    });
  } else if (kind === "reagendamento") {
    text = profWhatsAppReagendamento({
      profissional: profNome,
      profissionalGenero: profGenero,
      cliente: patient,
      clienteTelefone: patientPhone,
      servico: serv,
      novaData: formatDateBrFromIso(row.starts_at),
      novoHorario: formatHoraBrFromIso(row.starts_at),
    });
  } else {
    text = profWhatsAppCancelamento({
      profissional: profNome,
      profissionalGenero: profGenero,
      cliente: patient,
      clienteTelefone: patientPhone,
      servico: serv,
      data: formatDateBrFromIso(row.starts_at),
      hora: formatHoraBrFromIso(row.starts_at),
    });
  }

  void fetch("/api/whatsapp/notify-professional", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clinic_id: clinicId,
      phone,
      text,
    }),
  }).catch(() => {});
}

/** Dispara envio; não bloqueia UI (erros só no servidor / rede). */
export function fireNotifyProfessionalAfterPanelCancel(
  clinicId: string,
  rpcData: unknown,
  /** Id mostrado no painel (`cs:uuid` ou uuid de `appointments`) para não duplicar aviso no fluxo da agenda. */
  appointmentPanelId?: string
): void {
  const o = rpcData as PainelCancelCsResult | null;
  if (!o || o.ok !== true || !o.profissional_whatsapp?.trim()) return;

  const pid = appointmentPanelId?.trim();
  if (pid) skipDuplicateCancelProfNotifyIds.add(pid);

  const text = buildPainelCancelWhatsAppText({
    profissional_nome: o.profissional_nome,
    profissional_genero: o.profissional_genero,
    nome_cliente: o.nome_cliente,
    cliente_telefone: o.cliente_telefone,
    nome_procedimento: o.nome_procedimento,
    data_agendamento:
      typeof o.data_agendamento === "string"
        ? o.data_agendamento
        : o.data_agendamento != null
          ? String(o.data_agendamento)
          : null,
    horario: o.horario,
  });

  void fetch("/api/whatsapp/notify-professional", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clinic_id: clinicId,
      phone: o.profissional_whatsapp.trim(),
      text,
    }),
  }).catch(() => {});
}
