import { createClient } from "@/lib/supabase/server";

export type AuthLanding = {
  user: { id: string } | null;
  hasClinic: boolean;
};

/**
 * Resolve utilizador e se já tem clínica (owner_id), para redirecionar /login e /cadastro.
 */
export async function getAuthLanding(): Promise<AuthLanding> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { user: null, hasClinic: false };
    }
    const { data: row } = await supabase
      .from("clinics")
      .select("id")
      .eq("owner_id", user.id)
      .maybeSingle();
    return { user: { id: user.id }, hasClinic: !!row?.id };
  } catch {
    return { user: null, hasClinic: false };
  }
}
