import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type AdminOverviewSuccess = {
  ok: true;
  clinicsTotal: number;
  clinicsActive: number;
  clinicsInactive: number;
  byTipoPlano: { tipo: string; count: number }[];
  planosTotal: number;
  planosAtivos: number;
  planosInativos: number;
  appointmentsTotal: number;
  professionalsTotal: number;
  patientsTotal: number;
  memberRowsTotal: number;
};

export type AdminOverviewFail = {
  ok: false;
  message: string;
};

export type AdminOverview = AdminOverviewSuccess | AdminOverviewFail;

function countSafe(n: number | null | undefined): number {
  return typeof n === "number" && !Number.isNaN(n) ? n : 0;
}

/** Agregados da plataforma (service role). Usar só em rotas/layout já validadas como system admin. */
async function headCount(
  admin: SupabaseClient,
  table: string,
  filter?: { col: string; val: unknown }
) {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  if (filter) q = q.eq(filter.col, filter.val);
  const { count, error } = await q;
  if (error) return 0;
  return countSafe(count);
}

export async function getAdminOverview(): Promise<AdminOverview> {
  let admin: SupabaseClient;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : "Configure SUPABASE_SERVICE_ROLE_KEY em .env.local para métricas.",
    };
  }

  try {
    const [
      clinicsCount,
      clinicsActiveCount,
      clinicsRows,
      planosTotal,
      planosAtivos,
      apptCount,
      profCount,
      patCount,
      memCount,
    ] = await Promise.all([
      admin.from("clinics").select("*", { count: "exact", head: true }),
      admin.from("clinics").select("*", { count: "exact", head: true }).eq("ativo", true),
      admin.from("clinics").select("tipo_plano, ativo"),
      headCount(admin, "planos"),
      headCount(admin, "planos", { col: "ativo", val: true }),
      headCount(admin, "appointments"),
      headCount(admin, "professionals"),
      headCount(admin, "patients"),
      headCount(admin, "clinic_members"),
    ]);

    const byTipo = new Map<string, number>();
    for (const row of clinicsRows.data ?? []) {
      const t =
        typeof (row as { tipo_plano?: string }).tipo_plano === "string"
          ? (row as { tipo_plano: string }).tipo_plano
          : "—";
      byTipo.set(t, (byTipo.get(t) ?? 0) + 1);
    }
    const byTipoPlano = [...byTipo.entries()]
      .map(([tipo, count]) => ({ tipo, count }))
      .sort((a, b) => b.count - a.count);

    const clinicsTotal = countSafe(clinicsCount.count);
    const activeFromFlag = countSafe(clinicsActiveCount.count);
    const planosTot = planosTotal;
    const planosAtv = planosAtivos;
    const planosInativos = Math.max(0, planosTot - planosAtv);

    return {
      ok: true,
      clinicsTotal,
      clinicsActive: activeFromFlag,
      clinicsInactive: Math.max(0, clinicsTotal - activeFromFlag),
      byTipoPlano,
      planosTotal: planosTot,
      planosAtivos: planosAtv,
      planosInativos,
      appointmentsTotal: apptCount,
      professionalsTotal: profCount,
      patientsTotal: patCount,
      memberRowsTotal: memCount,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Falha ao ler estatísticas.",
    };
  }
}
