import type { Metadata } from "next";
import Link from "next/link";
import { getAdminOverview } from "@/lib/admin/overview-data";

export const metadata: Metadata = {
  title: "Dashboard",
};

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-700 bg-neutral-900/70 p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-amber-400">{value}</p>
      {sub ? <p className="mt-1 text-xs text-neutral-500">{sub}</p> : null}
    </div>
  );
}

export default async function AdminDashboardPage() {
  const overview = await getAdminOverview();

  return (
    <>
      <header className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-white">Dashboard Admin</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Resumo da plataforma multi-clínica e atalhos para gestão.
        </p>
      </header>

      {!overview.ok ? (
        <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          <p className="font-medium text-amber-400">Métricas indisponíveis</p>
          <p className="mt-1 text-neutral-300">{overview.message}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Clínicas" value={overview.clinicsTotal} sub={`${overview.clinicsActive} ativas · ${overview.clinicsInactive} inativas`} />
            <Stat label="Planos comerciais" value={overview.planosTotal} sub={`${overview.planosAtivos} ativos · ${overview.planosInativos} inativos`} />
            <Stat label="Agendamentos" value={overview.appointmentsTotal} sub="Tabela appointments" />
            <Stat label="Profissionais" value={overview.professionalsTotal} sub={`${overview.patientsTotal} pacientes · ${overview.memberRowsTotal} vínculos em clinic_members`} />
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-neutral-700 bg-neutral-900/50 p-5">
              <h2 className="text-sm font-semibold text-white">Clínicas por tipo de plano</h2>
              <ul className="mt-4 space-y-2">
                {overview.byTipoPlano.length === 0 ? (
                  <li className="text-sm text-neutral-500">Sem dados.</li>
                ) : (
                  overview.byTipoPlano.map((row) => (
                    <li
                      key={row.tipo}
                      className="flex items-center justify-between gap-2 border-b border-neutral-800/80 py-2 text-sm last:border-0"
                    >
                      <span className="font-mono text-neutral-300">{row.tipo}</span>
                      <span className="tabular-nums text-amber-400/90">{row.count}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="rounded-2xl border border-neutral-700 bg-neutral-900/50 p-5">
              <h2 className="text-sm font-semibold text-white">Atalhos</h2>
              <ul className="mt-4 space-y-2 text-sm">
                <li>
                  <Link href="/admin/clinicas" className="text-amber-400 hover:text-amber-300 hover:underline">
                    Ver todas as clínicas
                  </Link>
                  <span className="ml-2 text-neutral-500">— lista e IDs</span>
                </li>
                <li>
                  <Link href="/admin/planos" className="text-amber-400 hover:text-amber-300 hover:underline">
                    Planos e preços
                  </Link>
                  <span className="ml-2 text-neutral-500">— landing e assinaturas</span>
                </li>
                <li>
                  <Link href="/admin/financeiro" className="text-amber-400 hover:text-amber-300 hover:underline">
                    Financeiro
                  </Link>
                  <span className="ml-2 text-neutral-500">— inadimplência e expiração</span>
                </li>
                <li>
                  <Link href="/admin/metricas" className="text-amber-400 hover:text-amber-300 hover:underline">
                    Métricas
                  </Link>
                  <span className="ml-2 text-neutral-500">— distribuição e totais</span>
                </li>
                <li>
                  <Link href="/admin/logs" className="text-amber-400 hover:text-amber-300 hover:underline">
                    Logs e auditoria
                  </Link>
                  <span className="ml-2 text-neutral-500">— links Supabase / operações</span>
                </li>
              </ul>
            </div>
          </div>
        </>
      )}
    </>
  );
}
