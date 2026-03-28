import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseConfig } from "@/lib/supabase/env";

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 * Usa os cookies da sessão (atualizados pelo middleware).
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = getPublicSupabaseConfig();

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórios"
    );
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          /* Server Component: cookies só podem ser alterados em Ação/Middleware */
        }
      },
    },
  });
}
