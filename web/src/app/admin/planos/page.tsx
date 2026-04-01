import type { Metadata } from "next";
import { AdminPlanosManager } from "@/app/admin/_components/admin-planos-manager";

export const metadata: Metadata = {
  title: "Planos e Preços",
};

export default function AdminPlanosPage() {
  return (
    <>
      <header className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-white">Planos e Preços</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Configure os planos visíveis na landing e no painel das clínicas.
        </p>
      </header>
      <AdminPlanosManager />
    </>
  );
}
