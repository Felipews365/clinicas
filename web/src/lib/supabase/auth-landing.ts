import { createClient } from "@/lib/supabase/server";
import { isClinicMembersUnavailableError } from "@/lib/supabase/clinic-members-compat";

export type AuthLanding = {
  user: { id: string } | null;
  hasClinic: boolean;
};

/**
 * Resolve utilizador e se já tem clínica (dono ou clinic_members), para /login e /cadastro.
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
    const { data: owned } = await supabase
      .from("clinics")
      .select("id")
      .eq("owner_id", user.id)
      .limit(1)
      .maybeSingle();
    if (owned?.id) {
      return { user: { id: user.id }, hasClinic: true };
    }
    const { data: member, error: memErr } = await supabase
      .from("clinic_members")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (memErr && !isClinicMembersUnavailableError(memErr)) {
      return { user: { id: user.id }, hasClinic: false };
    }
    return { user: { id: user.id }, hasClinic: !!member?.id };
  } catch {
    return { user: null, hasClinic: false };
  }
}
