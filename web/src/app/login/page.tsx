import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ClinicLoginForm } from "@/components/auth/clinic-login-form";
import { getAuthLanding } from "@/lib/supabase/auth-landing";

export const metadata: Metadata = {
  title: "Entrar — Consultório",
  description: "Login seguro para o painel de agendamentos da clínica.",
};

function LoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-200">
      <p className="text-sm text-slate-500">A carregar…</p>
    </div>
  );
}

export default async function LoginPage() {
  const { user, hasClinic } = await getAuthLanding();
  if (user) {
    redirect(hasClinic ? "/painel" : "/cadastro");
  }

  return (
    <Suspense fallback={<LoginFallback />}>
      <ClinicLoginForm />
    </Suspense>
  );
}
