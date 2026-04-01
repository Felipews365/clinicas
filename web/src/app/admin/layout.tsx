import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/_components/admin-shell";
import { isSystemAdminUser } from "@/lib/system-admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: {
    default: "🛡 Admin — AgendaClinic",
    template: "%s | Admin — AgendaClinic",
  },
  description: "Painel de administração da plataforma (system admin).",
};

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login/admin?next=/admin/dashboard");
  }
  if (!isSystemAdminUser(user)) {
    redirect("/painel");
  }

  return <AdminShell>{children}</AdminShell>;
}
