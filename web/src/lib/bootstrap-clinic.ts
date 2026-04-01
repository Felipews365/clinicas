import type { SupabaseClient } from "@supabase/supabase-js";
import { computeTrialExpiryLocalDate } from "@/lib/trial";
import { isClinicMembersUnavailableError } from "@/lib/supabase/clinic-members-compat";

/** Rascunho de profissional no cadastro inicial (login / onboarding). */
export type ProfessionalDraft = {
  name: string;
  specialty: string;
};

export type ClinicBootstrapPayload = {
  clinicName: string;
  professionals: ProfessionalDraft[];
};

const STORAGE_KEY = "consultorio_pending_clinic_setup";

function normalizePayload(raw: unknown): ClinicBootstrapPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.clinicName !== "string") return null;

  if (Array.isArray(o.professionals)) {
    const professionals: ProfessionalDraft[] = [];
    for (const item of o.professionals) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name : "";
      const specialty =
        typeof row.specialty === "string" ? row.specialty : "";
      professionals.push({ name, specialty });
    }
    return { clinicName: o.clinicName, professionals };
  }

  /* Legado: só nomes (localStorage antigo) */
  if (Array.isArray(o.professionalNames)) {
    return {
      clinicName: o.clinicName,
      professionals: (o.professionalNames as unknown[]).map((n) => ({
        name: typeof n === "string" ? n : "",
        specialty: "",
      })),
    };
  }

  return null;
}

export function savePendingClinicSetup(payload: ClinicBootstrapPayload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function readPendingClinicSetup(): ClinicBootstrapPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizePayload(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function clearPendingClinicSetup() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function bootstrapClinicForUser(
  supabase: SupabaseClient,
  userId: string,
  payload: ClinicBootstrapPayload
): Promise<{ error: string | null }> {
  const name = payload.clinicName.trim();
  if (!name) return { error: "Indique o nome da clínica." };

  const pros = payload.professionals
    .map((p) => ({
      name: p.name.trim(),
      specialty: p.specialty.trim(),
    }))
    .filter((p) => p.name.length > 0);

  if (pros.length === 0) {
    return { error: "Indique pelo menos um profissional com nome." };
  }

  const { data: existingOwner } = await supabase
    .from("clinics")
    .select("id")
    .eq("owner_id", userId)
    .limit(1)
    .maybeSingle();

  if (existingOwner?.id) {
    return { error: null };
  }

  const { data: existingMember, error: memProbeErr } = await supabase
    .from("clinic_members")
    .select("clinic_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (memProbeErr && !isClinicMembersUnavailableError(memProbeErr)) {
    return { error: memProbeErr.message };
  }
  if (existingMember?.clinic_id) {
    return { error: null };
  }

  const { data: clinic, error: cErr } = await supabase
    .from("clinics")
    .insert({
      name,
      owner_id: userId,
      data_expiracao: computeTrialExpiryLocalDate(),
    })
    .select("id")
    .single();

  if (cErr || !clinic) {
    const msg = cErr?.message ?? "";
    const rls =
      cErr?.code === "42501" ||
      msg.toLowerCase().includes("row-level security");
    return {
      error: rls
        ? "Falta permissão no Supabase para criar a clínica. No painel: SQL Editor → execute o ficheiro supabase/rls_clinic_insert_owner.sql (política owners_insert_own_clinic)."
        : msg ||
          "Não foi possível criar a clínica. Verifique o projeto Supabase e as políticas RLS.",
    };
  }

  const clinicId = clinic.id as string;

  const { error: mErr } = await supabase.from("clinic_members").upsert(
    { clinic_id: clinicId, user_id: userId, role: "owner" },
    { onConflict: "clinic_id,user_id" }
  );
  if (mErr && !isClinicMembersUnavailableError(mErr)) {
    const msg = mErr.message;
    const rls =
      mErr.code === "42501" ||
      msg.toLowerCase().includes("row-level security");
    return {
      error: rls
        ? "Falha ao registar membro da clínica (clinic_members). Confirme a migração clinic_members e as políticas RLS."
        : msg,
    };
  }

  // 1. Criar cs_profissionais (necessário para o agente WhatsApp/n8n)
  const csRows = pros.map((p) => ({
    clinic_id: clinicId,
    nome: p.name,
    especialidade: p.specialty.length > 0 ? p.specialty : null,
    ativo: true,
  }));

  const { data: csPros, error: csErr } = await supabase
    .from("cs_profissionais")
    .insert(csRows)
    .select("id, nome");

  // cs_profissionais pode não existir em projetos sem o módulo n8n — ignorar erro
  const csMap = new Map<string, string>(
    (csPros ?? []).map((cp: { id: string; nome: string }) => [cp.nome, cp.id])
  );
  void csErr; // não bloquear o cadastro se cs_profissionais não existir

  // 2. Criar profissionais no painel, ligando ao cs_profissional correspondente
  const rows = pros.map((p, i) => ({
    clinic_id: clinicId,
    name: p.name,
    specialty: p.specialty.length > 0 ? p.specialty : null,
    is_active: true,
    sort_order: i,
    cs_profissional_id: csMap.get(p.name) ?? null,
  }));

  const { error: pErr } = await supabase.from("professionals").insert(rows);
  if (pErr) {
    const msg = pErr.message;
    const rls =
      pErr.code === "42501" ||
      msg.toLowerCase().includes("row-level security");
    return {
      error: rls
        ? "Falta permissão RLS na tabela professionals. Confirme no Supabase as políticas em supabase/schema.sql (owners_manage_professionals)."
        : msg,
    };
  }

  return { error: null };
}
