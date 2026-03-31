import type { PostgrestError } from "@supabase/supabase-js";

/**
 * True quando PostgREST ainda não expõe clinic_members (migração não aplicada).
 * Nesse caso o fluxo antigo com clinics.owner_id continua válido.
 */
export function isClinicMembersUnavailableError(
  err: PostgrestError | null | undefined
): boolean {
  if (!err?.message) return false;
  const m = err.message.toLowerCase();
  if (!m.includes("clinic_members")) return false;
  return (
    m.includes("schema cache") ||
    m.includes("does not exist") ||
    m.includes("not find the table")
  );
}
