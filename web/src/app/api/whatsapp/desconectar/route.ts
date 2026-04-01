import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { obterConfigEvolutionServidor } from "@/lib/env/evolution-server";

function evoHeaders(apiKey: string): HeadersInit {
  return { apikey: apiKey, "Content-Type": "application/json" };
}

export async function POST(req: Request) {
  const evo = obterConfigEvolutionServidor();
  if (!evo.valido) {
    return NextResponse.json(
      {
        error: "MISSING_SERVER_CONFIG",
        missing: evo.variaveisEmFalta,
        message: evo.mensagem,
      },
      { status: 503 }
    );
  }

  let body: { clinicId?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const clinicId = body.clinicId?.trim();
  if (!clinicId) {
    return NextResponse.json({ error: "BAD_REQUEST", message: "clinicId é obrigatório." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED", message: "Não autenticado." }, { status: 401 });
  }

  const { data: hasAccess, error: accessErr } = await supabase.rpc("rls_has_clinic_access", {
    p_clinic_id: clinicId,
  });
  if (accessErr || !hasAccess) {
    return NextResponse.json({ error: "FORBIDDEN", message: "Sem permissão para esta clínica." }, { status: 403 });
  }

  const { data: row } = await supabase
    .from("clinic_whatsapp_integrations")
    .select("instance_name")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  const instanceName = row?.instance_name?.trim();
  if (instanceName) {
    const logoutUrl = `${evo.config.url}/instance/logout/${encodeURIComponent(instanceName)}`;
    const evoRes = await fetch(logoutUrl, {
      method: "DELETE",
      headers: evoHeaders(evo.config.apiKey),
      cache: "no-store",
    });
    if (!evoRes.ok && evoRes.status !== 404) {
      const errBody = (await evoRes.json().catch(() => ({}))) as { message?: string };
      return NextResponse.json(
        {
          error: "EVOLUTION_ERROR",
          message: errBody.message ?? `Evolution não conseguiu desligar a instância (${evoRes.status}).`,
        },
        { status: 502 }
      );
    }
  }

  await supabase
    .from("clinic_whatsapp_integrations")
    .update({
      status: "disconnected",
      last_qr_code: null,
      last_connection_at: null,
      phone_number: null,
    })
    .eq("clinic_id", clinicId);

  await supabase.from("clinics").update({ status_whatsapp: "desconectado" }).eq("id", clinicId);

  return NextResponse.json({
    ok: true,
    status: "disconnected",
    message: "WhatsApp desativado para esta clínica. Pode voltar a conectar quando quiser.",
  });
}
