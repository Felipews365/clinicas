/**
 * Erros do PostgREST quando a relação ainda não existe ou não está no cache de schema
 * (migrations por aplicar no Supabase).
 */

export function isMissingProfessionalProceduresTableError(
  message: string | undefined,
): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  if (!m.includes("professional_procedures")) return false;
  return (
    m.includes("schema cache") ||
    m.includes("could not find") ||
    m.includes("does not exist")
  );
}
