import type { SupabaseClient } from "@supabase/supabase-js";
import { isClinicMembersUnavailableError } from "@/lib/supabase/clinic-members-compat";

export type ResolvedClinicForUser = {
  id: string;
  name: string | null;
  agenteAtivo: boolean;
};

export type ResolveClinicResult =
  | { ok: true; clinic: ResolvedClinicForUser }
  | { ok: false; reason: "none" }
  | { ok: false; reason: "error"; message: string };

type ClinicRow = {
  id: string;
  name: string | null;
  agente_ativo: boolean | null;
};

function rowToClinic(c: ClinicRow): ResolvedClinicForUser {
  return {
    id: c.id,
    name: c.name,
    agenteAtivo: c.agente_ativo !== false,
  };
}

/**
 * Caminho por tabelas (sujeito a RLS). Evita maybeSingle quando há mais do que uma linha.
 */
async function resolveClinicForUserViaTables(
  supabase: SupabaseClient,
  userId: string
): Promise<ResolveClinicResult> {
  const { data: ownedRows, error: ownedErr } = await supabase
    .from("clinics")
    .select("id, name, agente_ativo")
    .eq("owner_id", userId)
    .limit(1);

  if (ownedErr) {
    return { ok: false, reason: "error", message: ownedErr.message };
  }
  const owned = ownedRows?.[0];
  if (owned?.id) {
    return { ok: true, clinic: rowToClinic(owned as ClinicRow) };
  }

  const { data: membership, error: memErr } = await supabase
    .from("clinic_members")
    .select("clinic_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (memErr) {
    if (!isClinicMembersUnavailableError(memErr)) {
      return { ok: false, reason: "error", message: memErr.message };
    }
  } else if (membership?.clinic_id) {
    const { data: cRows, error: cMemErr } = await supabase
      .from("clinics")
      .select("id, name, agente_ativo")
      .eq("id", membership.clinic_id)
      .limit(1);
    if (cMemErr) {
      return { ok: false, reason: "error", message: cMemErr.message };
    }
    const cMem = cRows?.[0];
    if (cMem?.id) {
      return { ok: true, clinic: rowToClinic(cMem as ClinicRow) };
    }
    return {
      ok: false,
      reason: "error",
      message: "Clínica não encontrada.",
    };
  }

  const { data: profRows, error: profErr } = await supabase
    .from("professionals")
    .select("clinic_id")
    .eq("auth_user_id", userId)
    .limit(1);

  if (profErr) {
    const msg = profErr.message?.toLowerCase() ?? "";
    if (
      profErr.code === "PGRST204" ||
      msg.includes("does not exist") ||
      msg.includes("schema cache")
    ) {
      return { ok: false, reason: "none" };
    }
    return { ok: false, reason: "error", message: profErr.message };
  }
  const professional = profRows?.[0];
  if (!professional?.clinic_id) {
    return { ok: false, reason: "none" };
  }

  const { data: cProRows, error: cProErr } = await supabase
    .from("clinics")
    .select("id, name, agente_ativo")
    .eq("id", professional.clinic_id)
    .limit(1);

  if (cProErr) {
    return { ok: false, reason: "error", message: cProErr.message };
  }
  const cPro = cProRows?.[0];
  if (!cPro?.id) {
    return {
      ok: false,
      reason: "error",
      message: "Clínica não encontrada.",
    };
  }
  return { ok: true, clinic: rowToClinic(cPro as ClinicRow) };
}

function rpcResultRows(data: unknown): ClinicRow[] {
  if (data == null) return [];
  if (Array.isArray(data)) return data as ClinicRow[];
  return [data as ClinicRow];
}

/**
 * Resolve a clínica principal do utilizador: dono (clinics.owner_id),
 * membro (clinic_members) ou profissional com login (professionals.auth_user_id).
 *
 * Preferência: RPC `get_primary_clinic_for_user` no Supabase (migração 20260504120000),
 * que ignora falhas de RLS em cadeia; se não existir, usa SELECT no cliente.
 */
export async function resolveClinicForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<ResolveClinicResult> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "get_primary_clinic_for_user"
  );

  const rpcMissing =
    rpcErr &&
    (rpcErr.code === "PGRST202" ||
      rpcErr.code === "42883" ||
      /get_primary_clinic_for_user|function .* does not exist|schema cache/i.test(
        rpcErr.message ?? ""
      ));

  if (!rpcErr) {
    const rows = rpcResultRows(rpcData);
    const first = rows[0];
    if (first?.id) {
      return { ok: true, clinic: rowToClinic(first) };
    }
    return { ok: false, reason: "none" };
  }

  if (!rpcMissing) {
    return { ok: false, reason: "error", message: rpcErr.message };
  }

  return resolveClinicForUserViaTables(supabase, userId);
}
