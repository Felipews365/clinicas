import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/supabase/env";

/**
 * Atualiza a sessão Supabase (refresh do JWT) e sincroniza cookies entre
 * pedido e resposta. Deve correr em middleware em todas as rotas relevantes.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const { url, key } = getPublicSupabaseConfig();
  if (!url || !key) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Não coloque lógica pesada entre createServerClient e getUser().
  // getUser() valida o JWT com as chaves do projeto.
  await supabase.auth.getUser();

  return supabaseResponse;
}
