import type { Metadata } from "next";
import { getAdminClinicsList } from "@/lib/admin/clinics-data";

export const metadata: Metadata = {
  title: "Financeiro",
};

export default async function AdminFinanceiroPage() {
  const result = await getAdminClinicsList();
  const clinics = result.ok ? result.clinics : [];
  const inadimplentes = clinics.filter((c) => c.inadimplente === true);
  const trials = clinics.filter((c) => c.tipo_plano === "teste");
  const comExpiracao = clinics.filter((c) => c.data_expiracao);

  const porExpirar = [...comExpiracao].sort((a, b) => {
    const da = a.data_expiracao ?? "";
    const db = b.data_expiracao ?? "";
    return da.localeCompare(db);
  });

  return (
    <>
      <header className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-white">Financeiro</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Visão comercial: inadimplência, trials e datas de expiração (campos em{" "}
          <code className="rounded bg-neutral-800 px-1 text-xs">clinics</code>).
        </p>
      </header>

      {!result.ok ? (
        <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          {result.message}
        </div>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-neutral-700 bg-neutral-900/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Inadimplentes
              </p>
              <p className="mt-2 font-display text-2xl font-semibold text-orange-400">
                {inadimplentes.length}
              </p>
            </div>
            <div className="rounded-2xl border border-neutral-700 bg-neutral-900/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Em trial (teste)
              </p>
              <p className="mt-2 font-display text-2xl font-semibold text-amber-400">
                {trials.length}
              </p>
            </div>
            <div className="rounded-2xl border border-neutral-700 bg-neutral-900/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Com data de expiração
              </p>
              <p className="mt-2 font-display text-2xl font-semibold text-neutral-200">
                {comExpiracao.length}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-700 bg-neutral-900/40 p-5">
            <h2 className="text-sm font-semibold text-white">Prioridade: inadimplência</h2>
            {inadimplentes.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">Nenhuma clínica marcada como inadimplente.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm text-neutral-300">
                {inadimplentes.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-orange-900/40 bg-orange-950/20 px-3 py-2"
                  >
                    <span className="font-medium text-neutral-100">{c.name}</span>
                    <span className="font-mono text-xs text-neutral-500">{c.tipo_plano}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-700 bg-neutral-900/40 p-5">
            <h2 className="text-sm font-semibold text-white">Próximas expirações</h2>
            {porExpirar.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">Sem datas de expiração registadas.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm text-neutral-300">
                  <thead>
                    <tr className="border-b border-neutral-700 text-xs text-neutral-500">
                      <th className="py-2 pr-3">Clínica</th>
                      <th className="py-2 pr-3">Plano</th>
                      <th className="py-2">Expira</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porExpirar.slice(0, 40).map((c) => (
                      <tr key={c.id} className="border-b border-neutral-800/80">
                        <td className="py-2 pr-3 text-neutral-100">{c.name}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{c.tipo_plano}</td>
                        <td className="py-2">{c.data_expiracao}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
