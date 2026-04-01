import type { Metadata } from "next";
import { getAdminOverview } from "@/lib/admin/overview-data";

export const metadata: Metadata = {
  title: "Métricas",
};

export default async function AdminMetricasPage() {
  const overview = await getAdminOverview();

  if (!overview.ok) {
    return (
      <>
        <header className="mb-8">
          <h1 className="font-display text-2xl font-semibold text-white">Métricas</h1>
          <p className="mt-2 text-sm text-neutral-400">Indicadores agregados da plataforma.</p>
        </header>
        <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          {overview.message}
        </div>
      </>
    );
  }

  const maxTipo = Math.max(1, ...overview.byTipoPlano.map((r) => r.count));

  return (
    <>
      <header className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-white">Métricas</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Totais em tempo real (service role). Útil para acompanhar adoção e carga.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { k: "Clínicas", v: overview.clinicsTotal },
          { k: "Agendamentos", v: overview.appointmentsTotal },
          { k: "Profissionais", v: overview.professionalsTotal },
          { k: "Pacientes", v: overview.patientsTotal },
          { k: "Membros (clinic_members)", v: overview.memberRowsTotal },
          { k: "Planos ativos (catálogo)", v: overview.planosAtivos },
        ].map((row) => (
          <div
            key={row.k}
            className="rounded-2xl border border-neutral-700 bg-neutral-900/60 p-4 text-neutral-300"
          >
            <p className="text-xs font-medium text-neutral-500">{row.k}</p>
            <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-amber-400">
              {row.v}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-2xl border border-neutral-700 bg-neutral-900/50 p-6">
        <h2 className="text-sm font-semibold text-white">Distribuição: clínicas por tipo_plano</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Reflete o campo usado pelo n8n e pelo painel (código do plano comercial).
        </p>
        <div className="mt-6 space-y-4">
          {overview.byTipoPlano.length === 0 ? (
            <p className="text-sm text-neutral-500">Sem clínicas.</p>
          ) : (
            overview.byTipoPlano.map((row) => {
              const pct = Math.round((row.count / maxTipo) * 100);
              return (
                <div key={row.tipo}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-mono text-neutral-200">{row.tipo}</span>
                    <span className="tabular-nums text-amber-400/90">{row.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
