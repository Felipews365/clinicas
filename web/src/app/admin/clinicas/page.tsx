import type { Metadata } from "next";
import Link from "next/link";
import { AdminCopyButton } from "@/app/admin/_components/admin-copy-button";
import { getAdminClinicsList } from "@/lib/admin/clinics-data";

export const metadata: Metadata = {
  title: "Clínicas",
};

function badge(ok: boolean | null, labelOk: string, labelBad: string) {
  if (ok === true) {
    return (
      <span className="rounded-md bg-emerald-950/60 px-2 py-0.5 text-xs text-emerald-300">{labelOk}</span>
    );
  }
  if (ok === false) {
    return (
      <span className="rounded-md bg-red-950/50 px-2 py-0.5 text-xs text-red-300">{labelBad}</span>
    );
  }
  return <span className="text-neutral-500">—</span>;
}

export default async function AdminClinicasPage() {
  const result = await getAdminClinicsList();

  return (
    <>
      <header className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-white">Clínicas</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Todas as organizações registadas. Use os IDs para integrações (n8n, API, suporte).
        </p>
      </header>

      {!result.ok ? (
        <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          {result.message}
        </div>
      ) : result.clinics.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-600 bg-neutral-900/40 p-10 text-center text-sm text-neutral-500">
          Ainda não há clínicas na base de dados.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-700 bg-neutral-900/40 shadow-sm">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-700 text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3 font-medium">Clínica</th>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">Plano</th>
                <th className="px-4 py-3 font-medium">Código (n8n)</th>
                <th className="px-4 py-3 font-medium">Expira</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {result.clinics.map((c) => (
                <tr key={c.id} className="border-b border-neutral-800/90 text-neutral-300 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium text-neutral-100">{c.name}</span>
                    {c.numero_clinica ? (
                      <span className="mt-0.5 block text-xs text-neutral-500">
                        n.º clínica: {c.numero_clinica}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-400">
                    <span className="block max-w-[140px] truncate" title={c.id}>
                      {c.id.slice(0, 8)}…
                    </span>
                    <AdminCopyButton text={c.id} label="Copiar UUID" />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-amber-200/90">{c.tipo_plano ?? "—"}</span>
                    {c.plano_nome ? (
                      <span className="mt-0.5 block text-xs text-neutral-500">{c.plano_nome}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{c.plano_codigo ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">{c.data_expiracao ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {badge(c.ativo, "Ativa", "Inativa")}
                      {c.inadimplente ? (
                        <span className="rounded-md bg-orange-950/60 px-2 py-0.5 text-xs text-orange-200">
                          Inadimplente
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-600">Regular</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-neutral-500">
        O dono da clínica gere a assinatura no{" "}
        <Link href="/painel" className="text-amber-500/80 hover:underline">
          painel
        </Link>
        . Aqui só consulta global.
      </p>
    </>
  );
}
