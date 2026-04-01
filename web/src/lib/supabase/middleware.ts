import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeAdminPostLoginNext, safePostLoginNext } from "@/lib/auth-redirect";
import { hasFullAccess, type ClinicaCrmGate } from "@/lib/crm-access";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/admin") && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login/admin";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", safeAdminPostLoginNext(pathname));
    return NextResponse.redirect(redirectUrl);
  }
  if (pathname.startsWith("/painel") && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", safePostLoginNext(pathname));
    return NextResponse.redirect(redirectUrl);
  }

  const crmMatch = pathname.match(
    /^\/clinica\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/crm\/?$/i
  );
  if (crmMatch) {
    if (!user) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("next", safePostLoginNext(pathname));
      return NextResponse.redirect(redirectUrl);
    }
    const clinicId = crmMatch[1];
    const { data: row } = await supabase
      .from("clinics")
      .select(
        "tipo_plano, data_expiracao, ativo, inadimplente, plan_tem_crm"
      )
      .eq("id", clinicId)
      .maybeSingle();

    const gate: ClinicaCrmGate | null = row
      ? {
          tipo_plano: typeof row.tipo_plano === "string" ? row.tipo_plano : "teste",
          data_expiracao:
            row.data_expiracao == null
              ? null
              : typeof row.data_expiracao === "string"
                ? row.data_expiracao.slice(0, 10)
                : String(row.data_expiracao).slice(0, 10),
          ativo: row.ativo !== false,
          inadimplente: !!row.inadimplente,
          plan_tem_crm:
            row.plan_tem_crm === true || String(row.plan_tem_crm) === "true",
        }
      : null;

    if (!gate || !hasFullAccess(gate)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/painel";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("crm_upgrade", "1");
      return NextResponse.redirect(redirectUrl);
    }
  }

  return supabaseResponse;
}
