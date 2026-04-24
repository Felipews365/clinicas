import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { normalizeProfessionalWhatsappBr } from "@/lib/br-whatsapp";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  formatDateBrFromYmd,
  formatHoraBr,
  normalizeProfissionalGenero,
  profWhatsAppCancelamento,
  profWhatsAppNovoAgendamento,
  profWhatsAppReagendamento,
  type ProfissionalGenero,
} from "@/lib/professional-notify-message";
import { sendEvolutionClinicInstanceText } from "@/lib/whatsapp-evolution-send";
import { withProfessionalsGenderFallback } from "@/lib/supabase-gender-column-fallback";

const DEDUPE_MS = 90_000;

type NotifyKind = "new" | "cancel" | "reschedule";

type CsRow = {
  id: string;
  clinic_id: string | null;
  profissional_id: string;
  cliente_id: string | null;
  data_agendamento: string;
  horario: string;
  status: string;
  nome_cliente: string | null;
  nome_procedimento: string | null;
  painel_confirmado?: boolean | null;
};

function normHorario(h: unknown): string {
  const s = String(h ?? "").trim();
  if (!s) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : s.slice(0, 5);
}

function normDate(d: unknown): string {
  return String(d ?? "").trim().slice(0, 10);
}

function isTerminalStatus(s: string): boolean {
  return s === "cancelado" || s === "concluido";
}

function onlyPainelOrNotesChanged(oldR: Record<string, unknown>, newR: Record<string, unknown>): boolean {
  if (String(oldR.status ?? "") !== String(newR.status ?? "")) return false;
  if (normDate(oldR.data_agendamento) !== normDate(newR.data_agendamento)) return false;
  if (normHorario(oldR.horario) !== normHorario(newR.horario)) return false;
  return true;
}

function parseWebhookPayload(body: unknown): {
  type: string;
  table: string;
  record: Record<string, unknown> | null;
  oldRecord: Record<string, unknown> | null;
} | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const type = String(b.type ?? b.eventType ?? "").toUpperCase();
  const table = String(b.table ?? "");
  const record =
    (b.record as Record<string, unknown> | undefined) ??
    (b.new as Record<string, unknown> | undefined) ??
    (b.new_record as Record<string, unknown> | undefined) ??
    null;
  const oldRecord =
    (b.old_record as Record<string, unknown> | undefined) ??
    (b.old as Record<string, unknown> | undefined) ??
    null;
  return { type, table, record, oldRecord };
}

function authOk(req: Request): boolean {
  const secret = process.env.CS_AGENDAMENTO_NOTIFY_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get("authorization")?.trim() ?? "";
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix)) return false;
  const token = auth.slice(prefix.length);
  try {
    const a = Buffer.from(secret, "utf8");
    const b = Buffer.from(token, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function loadCsRow(admin: ReturnType<typeof createServiceRoleClient>, id: string) {
  const { data, error } = await admin
    .from("cs_agendamentos")
    .select(
      "id, clinic_id, profissional_id, cliente_id, data_agendamento, horario, status, nome_cliente, nome_procedimento, painel_confirmado"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: null as CsRow | null, error: error.message };
  return { row: data as CsRow | null, error: null as string | null };
}

async function resolveClienteNome(
  admin: ReturnType<typeof createServiceRoleClient>,
  clienteId: string | null,
  clinicId: string | null
): Promise<string | null> {
  if (!clienteId || !clinicId) return null;
  const { data } = await admin
    .from("cs_clientes")
    .select("nome")
    .eq("id", clienteId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  const n = (data as { nome?: string } | null)?.nome?.trim();
  return n || null;
}

async function resolveClienteTelefone(
  admin: ReturnType<typeof createServiceRoleClient>,
  clienteId: string | null,
  clinicId: string | null
): Promise<string | null> {
  if (!clienteId || !clinicId) return null;
  const { data } = await admin
    .from("cs_clientes")
    .select("telefone")
    .eq("id", clienteId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  const t = (data as { telefone?: string } | null)?.telefone?.trim();
  return t || null;
}

async function resolveProfWhatsapp(
  admin: ReturnType<typeof createServiceRoleClient>,
  clinicId: string,
  profissionalId: string
): Promise<string | null> {
  const { data: byCs } = await admin
    .from("professionals")
    .select("whatsapp")
    .eq("clinic_id", clinicId)
    .eq("cs_profissional_id", profissionalId)
    .maybeSingle();
  const w1 = (byCs as { whatsapp?: string | null } | null)?.whatsapp?.trim();
  if (w1) return w1;
  const { data: byId } = await admin
    .from("professionals")
    .select("whatsapp")
    .eq("clinic_id", clinicId)
    .eq("id", profissionalId)
    .maybeSingle();
  const w2 = (byId as { whatsapp?: string | null } | null)?.whatsapp?.trim();
  return w2 || null;
}

async function resolveProfissionalNotifyMeta(
  admin: ReturnType<typeof createServiceRoleClient>,
  clinicId: string,
  profissionalId: string
): Promise<{ nome: string | null; genero: ProfissionalGenero }> {
  const { data: byCs } = await withProfessionalsGenderFallback(async (g) => {
    const res = await admin
      .from("professionals")
      .select(g ? "name, gender" : "name")
      .eq("clinic_id", clinicId)
      .eq("cs_profissional_id", profissionalId)
      .maybeSingle();
    return { data: res.data, error: res.error };
  });
  const rowCs = byCs as { name?: string | null; gender?: string | null } | null;
  const n1 = rowCs?.name?.trim();
  if (n1) {
    return {
      nome: n1,
      genero: normalizeProfissionalGenero(rowCs?.gender),
    };
  }
  const { data: byId } = await withProfessionalsGenderFallback(async (g) => {
    const res = await admin
      .from("professionals")
      .select(g ? "name, gender" : "name")
      .eq("clinic_id", clinicId)
      .eq("id", profissionalId)
      .maybeSingle();
    return { data: res.data, error: res.error };
  });
  const rowId = byId as { name?: string | null; gender?: string | null } | null;
  const n2 = rowId?.name?.trim();
  if (n2) {
    return {
      nome: n2,
      genero: normalizeProfissionalGenero(rowId?.gender),
    };
  }
  const { data: cs } = await withProfessionalsGenderFallback(async (g) => {
    const res = await admin
      .from("cs_profissionais")
      .select(g ? "nome, gender" : "nome")
      .eq("id", profissionalId)
      .maybeSingle();
    return { data: res.data, error: res.error };
  });
  const rowP = cs as { nome?: string | null; gender?: string | null } | null;
  const n3 = rowP?.nome?.trim();
  return {
    nome: n3 || null,
    genero: normalizeProfissionalGenero(rowP?.gender),
  };
}

async function recentDedupe(
  admin: ReturnType<typeof createServiceRoleClient>,
  agId: string,
  kind: NotifyKind
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_MS).toISOString();
  const { data } = await admin
    .from("cs_prof_notify_outbox")
    .select("id")
    .eq("cs_agendamento_id", agId)
    .eq("kind", kind)
    .gte("sent_at", since)
    .limit(1)
    .maybeSingle();
  return data != null;
}

async function recordSent(
  admin: ReturnType<typeof createServiceRoleClient>,
  agId: string,
  kind: NotifyKind
) {
  await admin.from("cs_prof_notify_outbox").insert({ cs_agendamento_id: agId, kind });
}

/**
 * Database Webhook (Supabase) em `public.cs_agendamentos`.
 * Cabeçalho: Authorization: Bearer CS_AGENDAMENTO_NOTIFY_WEBHOOK_SECRET
 */
export async function POST(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = parseWebhookPayload(body);
  if (!parsed || parsed.table !== "cs_agendamentos") {
    return NextResponse.json({ ok: true, skipped: "not_cs_agendamentos" });
  }

  const { type, record, oldRecord } = parsed;
  if (type !== "INSERT" && type !== "UPDATE") {
    return NextResponse.json({ ok: true, skipped: type.toLowerCase() || "event" });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "service_role";
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  let agId: string | null = null;
  let kind: NotifyKind | null = null;

  if (type === "INSERT" && record) {
    agId = String(record.id ?? "");
    const st = String(record.status ?? "");
    if (!agId || isTerminalStatus(st)) {
      return NextResponse.json({ ok: true, skipped: "insert_terminal_or_bad" });
    }
    kind = "new";
  } else if (type === "UPDATE" && record) {
    agId = String(record.id ?? "");
    if (!agId) {
      return NextResponse.json({ ok: true, skipped: "no_id" });
    }
    const newSt = String(record.status ?? "");

    if (!oldRecord) {
      if (newSt === "cancelado") {
        kind = "cancel";
      } else {
        return NextResponse.json({ ok: true, skipped: "update_no_old_record" });
      }
    } else {
      if (onlyPainelOrNotesChanged(oldRecord, record)) {
        return NextResponse.json({ ok: true, skipped: "metadata_only" });
      }

      const oldSt = String(oldRecord.status ?? "");
      if (!isTerminalStatus(oldSt) && newSt === "cancelado") {
        kind = "cancel";
      } else if (
        !isTerminalStatus(oldSt) &&
        !isTerminalStatus(newSt) &&
        (normDate(oldRecord.data_agendamento) !== normDate(record.data_agendamento) ||
          normHorario(oldRecord.horario) !== normHorario(record.horario))
      ) {
        kind = "reschedule";
      } else {
        return NextResponse.json({ ok: true, skipped: "update_no_notify_rule" });
      }
    }
  } else {
    return NextResponse.json({ ok: true, skipped: "no_rows" });
  }

  if (!kind || !agId) {
    return NextResponse.json({ ok: true, skipped: "no_kind" });
  }

  if (await recentDedupe(admin, agId, kind)) {
    return NextResponse.json({ ok: true, skipped: "dedupe" });
  }

  const { row, error: loadErr } = await loadCsRow(admin, agId);
  if (loadErr || !row?.clinic_id) {
    return NextResponse.json({ ok: true, skipped: "row_not_found", detail: loadErr });
  }

  const clinicId = row.clinic_id;
  let nome = row.nome_cliente?.trim() || (await resolveClienteNome(admin, row.cliente_id, clinicId));
  nome = nome?.trim() || "Cliente";
  const clienteTel = await resolveClienteTelefone(admin, row.cliente_id, clinicId);
  const serv = (row.nome_procedimento || "Consulta").trim();

  const phoneRaw = await resolveProfWhatsapp(admin, clinicId, row.profissional_id);
  if (!phoneRaw) {
    return NextResponse.json({ ok: true, skipped: "no_professional_whatsapp" });
  }

  const norm = normalizeProfessionalWhatsappBr(phoneRaw);
  if (!norm.ok || !norm.digits) {
    return NextResponse.json({ ok: true, skipped: "invalid_whatsapp" });
  }

  const { nome: profNome, genero: profGenero } =
    await resolveProfissionalNotifyMeta(admin, clinicId, row.profissional_id);

  let text: string;
  if (kind === "new") {
    text = profWhatsAppNovoAgendamento({
      profissional: profNome,
      profissionalGenero: profGenero,
      cliente: nome,
      clienteTelefone: clienteTel,
      servico: serv,
      data: formatDateBrFromYmd(row.data_agendamento),
      hora: formatHoraBr(row.horario),
    });
  } else if (kind === "cancel") {
    const dataYmd =
      oldRecord && !isTerminalStatus(String(oldRecord.status ?? ""))
        ? normDate(oldRecord.data_agendamento)
        : normDate(record?.data_agendamento) || String(row.data_agendamento);
    const horaRaw =
      oldRecord && !isTerminalStatus(String(oldRecord.status ?? ""))
        ? oldRecord.horario
        : record?.horario ?? row.horario;
    text = profWhatsAppCancelamento({
      profissional: profNome,
      profissionalGenero: profGenero,
      cliente: nome,
      clienteTelefone: clienteTel,
      servico: serv,
      data: formatDateBrFromYmd(dataYmd),
      hora: formatHoraBr(horaRaw),
    });
  } else {
    text = profWhatsAppReagendamento({
      profissional: profNome,
      profissionalGenero: profGenero,
      cliente: nome,
      clienteTelefone: clienteTel,
      servico: serv,
      novaData: formatDateBrFromYmd(row.data_agendamento),
      novoHorario: formatHoraBr(row.horario),
    });
  }

  const sent = await sendEvolutionClinicInstanceText(clinicId, norm.digits, text);
  if (!sent.ok) {
    return NextResponse.json(
      { error: sent.message, status: sent.status ?? 502 },
      { status: 502 }
    );
  }

  await recordSent(admin, agId, kind);
  return NextResponse.json({ ok: true, kind });
}
