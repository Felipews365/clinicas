import { NextResponse } from "next/server";
import { getPublicSupabaseConfig } from "@/lib/supabase/env";

/**
 * Diagnóstico: variáveis carregadas? O servidor consegue falar com o Supabase?
 * Abra no browser: http://localhost:3000/api/health/supabase
 */
export async function GET() {
  const { url, key } = getPublicSupabaseConfig();

  if (!url || !key) {
    return NextResponse.json(
      {
        ok: false,
        reason: "missing_env",
        hint:
          "Crie consultorio/web/.env.local com NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (sem aspas estranhas). Reinicie npm run dev.",
      },
      { status: 200 }
    );
  }

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        reason: "invalid_url",
        hint: "NEXT_PUBLIC_SUPABASE_URL deve ser tipo https://xxxx.supabase.co",
      },
      { status: 200 }
    );
  }

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(t);

    return NextResponse.json({
      ok: res.ok,
      httpStatus: res.status,
      host,
      message: res.ok
        ? "Servidor Next consegue contactar o Supabase Auth. Se o browser ainda falha, teste outro browser ou desative extensões."
        : `Auth health respondeu HTTP ${res.status}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: false,
      reason: "fetch_failed",
      host,
      message: msg,
      hint:
        "O próprio Next (servidor) não conseguiu ligar ao Supabase: firewall, DNS, VPN, projeto pausado ou URL errada. Teste no PowerShell: curl.exe -I " +
        url +
        "/auth/v1/health",
    });
  }
}
