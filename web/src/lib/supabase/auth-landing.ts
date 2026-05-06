import { resolveClinicForUser } from "@/lib/supabase/clinic-access-resolve";
import { createClient } from "@/lib/supabase/server";

export type AuthLanding = {
  user: { id: string } | null;
  hasClinic: boolean;
};

/**
 * Resolve utilizador e se já tem clínica (dono, clinic_members ou professionals.auth_user_id).
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
    const resolved = await resolveClinicForUser(supabase, user.id);
    return {
      user: { id: user.id },
      hasClinic: resolved.ok === true,
    };
  } catch {
    return { user: null, hasClinic: false };
  }
}
