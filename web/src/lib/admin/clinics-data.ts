import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type AdminClinicRow = {
  id: string;
  name: string;
  owner_id: string | null;
  tipo_plano: string | null;
  plan_id: string | null;
  ativo: boolean | null;
  inadimplente: boolean | null;
  data_expiracao: string | null;
  numero_clinica: string | null;
  created_at: string | null;
  plano_nome: string | null;
  plano_codigo: string | null;
};

export type AdminClinicsResult =
  | { ok: true; clinics: AdminClinicRow[] }
  | { ok: false; message: string };

export async function getAdminClinicsList(): Promise<AdminClinicsResult> {
  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : "Configure SUPABASE_SERVICE_ROLE_KEY para listar clínicas.",
    };
  }

  try {
    const { data, error } = await admin
      .from("clinics")
      .select(
        "id, name, owner_id, tipo_plano, plan_id, ativo, inadimplente, data_expiracao, numero_clinica, created_at"
      )
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, message: error.message };
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const planIds = [
      ...new Set(
        rows
          .map((r) => r.plan_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];

    const planoById = new Map<string, { nome: string; codigo: string }>();
    if (planIds.length > 0) {
      const { data: planRows, error: planErr } = await admin
        .from("planos")
        .select("id, nome, codigo")
        .in("id", planIds);
      if (!planErr && planRows) {
        for (const p of planRows) {
          const row = p as { id: string; nome: string; codigo: string };
          planoById.set(row.id, { nome: row.nome, codigo: row.codigo });
        }
      }
    }

    const clinics: AdminClinicRow[] = rows.map((raw) => {
      const pid = raw.plan_id != null ? String(raw.plan_id) : null;
      const plan = pid ? planoById.get(pid) : undefined;
      return {
        id: String(raw.id),
        name: typeof raw.name === "string" ? raw.name : "—",
        owner_id: raw.owner_id != null ? String(raw.owner_id) : null,
        tipo_plano: raw.tipo_plano != null ? String(raw.tipo_plano) : null,
        plan_id: pid,
        ativo: raw.ativo === true || raw.ativo === false ? raw.ativo : null,
        inadimplente:
          raw.inadimplente === true || raw.inadimplente === false
            ? raw.inadimplente
            : null,
        data_expiracao:
          raw.data_expiracao != null ? String(raw.data_expiracao).slice(0, 10) : null,
        numero_clinica: raw.numero_clinica != null ? String(raw.numero_clinica) : null,
        created_at: raw.created_at != null ? String(raw.created_at) : null,
        plano_nome: plan?.nome ?? null,
        plano_codigo: plan?.codigo ?? null,
      };
    });

    return { ok: true, clinics };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Falha ao carregar clínicas.",
    };
  }
}
