import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminRegisterForm } from "@/components/auth/admin-register-form";
import { isSystemAdminUser } from "@/lib/system-admin";
import { getAuthLanding } from "@/lib/supabase/auth-landing";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "🛡 Cadastro — Administração",
  description: "Criar conta para administradores da plataforma (sem cadastro de clínica).",
};

function Fallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
      <p className="text-sm text-neutral-500">A carregar…</p>
    </div>
  );
}

export default async function AdminCadastroPage() {
  const { user, hasClinic } = await getAuthLanding();

  if (user) {
    const supabase = await createClient();
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();
    if (sessionUser && isSystemAdminUser(sessionUser)) {
      redirect("/admin/dashboard");
    }
    if (hasClinic) {
      redirect("/painel");
    }
    /* Contautenticado sem clínica: pode ser conta de admin recente (ainda sem SYSTEM_ADMIN_EMAILS).
       O formulário cliente mostra estado "Já tem sessão" com links. */
  }

  return (
    <Suspense fallback={<Fallback />}>
      <AdminRegisterForm />
    </Suspense>
  );
}
