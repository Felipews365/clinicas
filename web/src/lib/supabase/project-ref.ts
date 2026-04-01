/** Extrai o project ref do host `xxxx.supabase.co` a partir de NEXT_PUBLIC_SUPABASE_URL. */
export function getSupabaseProjectRef(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const ref = host.split(".")[0];
    if (!ref || ref === "localhost") return null;
    return ref;
  } catch {
    return null;
  }
}
