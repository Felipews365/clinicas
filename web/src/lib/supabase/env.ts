/** Normaliza URL do projeto (espaços, barra final, https em falta). */
export function normalizeSupabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const u = raw.trim().replace(/\/+$/, "");
  if (!u.startsWith("http")) return `https://${u.replace(/^\/+/, "")}`;
  return u;
}

export function getPublicSupabaseConfig(): {
  url: string | undefined;
  key: string | undefined;
} {
  return {
    url: normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  };
}
