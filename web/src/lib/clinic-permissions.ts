import { createClient } from "@/lib/supabase/server";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export async function canManageClinic(
  supabase: SupabaseServer,
  clinicId: string,
  userId: string
): Promise<boolean> {
  const { data: clinic, error: cErr } = await supabase
    .from("clinics")
    .select("owner_id")
    .eq("id", clinicId)
    .maybeSingle();

  if (cErr || !clinic) return false;
  if (clinic.owner_id === userId) return true;

  const { data: member } = await supabase
    .from("clinic_members")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();

  const role = member?.role;
  return role === "owner" || role === "admin";
}
