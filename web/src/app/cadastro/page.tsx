import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ClinicRegisterForm } from "@/components/auth/clinic-register-form";
import { getAuthLanding } from "@/lib/supabase/auth-landing";

export const metadata: Metadata = {
  title: "Cadastro — Consultório",
  description: "Registe a clínica e a equipa de profissionais.",
};

function CadastroFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-200">
      <p className="text-sm text-slate-500">A carregar…</p>
    </div>
  );
}

export default async function CadastroPage() {
  const { user, hasClinic } = await getAuthLanding();
  if (user && hasClinic) {
    redirect("/painel");
  }

  return (
    <Suspense fallback={<CadastroFallback />}>
      <ClinicRegisterForm />
    </Suspense>
  );
}
