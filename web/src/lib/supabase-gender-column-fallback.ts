import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Coluna `professionals.gender` (e espelho em `cs_profissionais`) vem da migration
 * `20260427200000_professionals_gender_dr_dra.sql`. Se ainda não foi aplicada,
 * o PostgREST devolve erro do tipo «column professionals_1.gender does not exist».
 */
/** Erro quando a coluna `gender` não existe na BD ou o cache de schema do PostgREST ainda não a inclui. */
export function isMissingGenderColumnError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  if (!m.includes("gender")) return false;
  return (
    m.includes("does not exist") ||
    m.includes("schema cache") ||
    m.includes("could not find")
  );
}

/** Tenta com género; se a coluna não existir, repete sem `gender`. */
export async function withProfessionalsGenderFallback<T>(
  run: (includeGender: boolean) => Promise<{ data: T; error: PostgrestError | null }>
): Promise<{ data: T; error: PostgrestError | null }> {
  const first = await run(true);
  if (!first.error) return first;
  if (!isMissingGenderColumnError(first.error.message)) return first;
  return run(false);
}
