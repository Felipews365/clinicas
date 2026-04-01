import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminLoginForm } from "@/components/auth/admin-login-form";
import { safeAdminPostLoginNext } from "@/lib/auth-redirect";
import { isSystemAdminUser } from "@/lib/system-admin";
import { getAuthLanding } from "@/lib/supabase/auth-landing";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "🛡 Entrar — Administração",
  description: "Login exclusivo para administradores da plataforma AgendaClinic.",
};

function AdminLoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
      <p className="text-sm text-neutral-500">A carregar…</p>
    </div>
  );
}

type Props = {
  searchParams?: Promise<{ next?: string | string[] }>;
};

export default async function AdminLoginPage({ searchParams }: Props) {
  const { user } = await getAuthLanding();
  const sp = searchParams ? await searchParams : {};
  const nextRaw = typeof sp.next === "string" ? sp.next : undefined;
  const next = safeAdminPostLoginNext(nextRaw ?? null);

  if (user) {
    const supabase = await createClient();
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();
    if (sessionUser && isSystemAdminUser(sessionUser)) {
      redirect(next);
    }
    redirect("/painel");
  }

  return (
    <Suspense fallback={<AdminLoginFallback />}>
      <AdminLoginForm />
    </Suspense>
  );
}
