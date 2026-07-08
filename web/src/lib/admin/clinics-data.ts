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
  cost_mes_atual_usd: number;
  cost_mes_atual_brl: number;
  cost_total_usd: number;
  cost_total_brl: number;
  tokens_mes_atual: number;
  chamadas_mes_atual: number;
  chamadas_total: number;
  ultima_chamada_at: string | null;
  usd_brl_rate: number;
};

const DEFAULT_USD_BRL_RATE = 5.5;

export function getUsdBrlRate(): number {
  const raw = process.env.USD_BRL_RATE;
  if (!raw) return DEFAULT_USD_BRL_RATE;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_USD_BRL_RATE;
}

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

    const usdBrl = getUsdBrlRate();
    type UsageRow = {
      clinic_id: string;
      cost_mes_atual_usd: number | string | null;
      cost_total_usd: number | string | null;
      tokens_mes_atual: number | string | null;
      chamadas_mes_atual: number | string | null;
      chamadas_total: number | string | null;
      ultima_chamada_at: string | null;
    };
    const usageByClinic = new Map<string, UsageRow>();
    try {
      const { data: usageRows, error: usageErr } = await admin.rpc(
        "admin_ai_usage_per_clinic"
      );
      if (!usageErr && Array.isArray(usageRows)) {
        for (const u of usageRows as UsageRow[]) {
          if (u?.clinic_id) usageByClinic.set(String(u.clinic_id), u);
        }
      }
    } catch {
      // log silencioso; coluna mostra zero se a RPC falhar
    }

    const clinics: AdminClinicRow[] = rows.map((raw) => {
      const pid = raw.plan_id != null ? String(raw.plan_id) : null;
      const plan = pid ? planoById.get(pid) : undefined;
      const usage = usageByClinic.get(String(raw.id));
      const mesUsd = Number(usage?.cost_mes_atual_usd ?? 0) || 0;
      const totalUsd = Number(usage?.cost_total_usd ?? 0) || 0;
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
        cost_mes_atual_usd: mesUsd,
        cost_mes_atual_brl: mesUsd * usdBrl,
        cost_total_usd: totalUsd,
        cost_total_brl: totalUsd * usdBrl,
        tokens_mes_atual: Number(usage?.tokens_mes_atual ?? 0) || 0,
        chamadas_mes_atual: Number(usage?.chamadas_mes_atual ?? 0) || 0,
        chamadas_total: Number(usage?.chamadas_total ?? 0) || 0,
        ultima_chamada_at: usage?.ultima_chamada_at ?? null,
        usd_brl_rate: usdBrl,
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
