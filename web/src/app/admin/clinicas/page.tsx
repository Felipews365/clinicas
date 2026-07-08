import type { Metadata } from "next";
import Link from "next/link";
import { AdminAiBudgetCard } from "@/app/admin/_components/admin-ai-budget-card";
import { AdminClinicsTable } from "@/app/admin/_components/admin-clinics-table";
import { getAdminClinicsList } from "@/lib/admin/clinics-data";

export const metadata: Metadata = {
  title: "Clínicas",
};

export const dynamic = "force-dynamic";

export default async function AdminClinicasPage() {
  const result = await getAdminClinicsList();

  return (
    <>
      <header className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-white">Clínicas</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Edite expiração do trial, reactive ou regularize cada clínica. O trial padrão é de 7 dias
          (botão «Trial 7d» reseta).
        </p>
      </header>

      <AdminAiBudgetCard />

      {!result.ok ? (
        <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          {result.message}
        </div>
      ) : result.clinics.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-600 bg-neutral-900/40 p-10 text-center text-sm text-neutral-500">
          Ainda não há clínicas na base de dados.
        </div>
      ) : (
        <AdminClinicsTable clinics={result.clinics} />
      )}

      <p className="mt-6 text-xs text-neutral-500">
        O dono da clínica gere o número/identificador no{" "}
        <Link href="/painel" className="text-amber-500/80 hover:underline">
          painel
        </Link>
        . Aqui o admin da plataforma controla acesso e validade.
      </p>
    </>
  );
}
