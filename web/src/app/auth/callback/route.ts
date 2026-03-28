import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/supabase/env";

/**
 * OAuth (Google, etc.): troca ?code= por sessão em cookies e redireciona.
 * No Supabase: Authentication → URL Configuration → Redirect URLs inclua
 * http://localhost:3000/auth/callback (e o domínio em produção).
 * Use ?next=/cadastro após «Continuar com Google» no registo.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_missing_code`);
  }

  const { url, key } = getPublicSupabaseConfig();
  if (!url || !key) {
    return NextResponse.redirect(`${origin}/login?error=auth_config`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
