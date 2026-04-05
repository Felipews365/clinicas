import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { obterConfigEvolutionServidor } from "@/lib/env/evolution-server";

export async function POST(req: Request) {
  const evo = obterConfigEvolutionServidor();
  if (!evo.valido) {
    return NextResponse.json({ error: "Evolution API não configurada" }, { status: 503 });
  }

  let body: { session_id?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const sessionId = body.session_id?.trim();
  const message = body.message?.trim();
  if (!sessionId || !message) {
    return NextResponse.json({ error: "session_id e message são obrigatórios" }, { status: 400 });
  }

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  // Busca sessão
  const { data: session, error: sesErr } = await authClient
    .from("whatsapp_sessions")
    .select("id, clinic_id, phone")
    .eq("id", sessionId)
    .maybeSingle();

  if (sesErr || !session) {
    return NextResponse.json({ error: sesErr?.message ?? "Sessão não encontrada" }, { status: 404 });
  }

  // Verifica acesso
  const { data: hasAccess } = await authClient.rpc("rls_has_clinic_access", {
    p_clinic_id: session.clinic_id,
  });
  if (!hasAccess) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const { url: evoUrl, apiKey: evoKey } = evo.config;
  const instanceName = `clinica-${session.clinic_id}`;

  // Envia via Evolution API
  const evoRes = await fetch(`${evoUrl}/message/sendText/${instanceName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: evoKey },
    body: JSON.stringify({ number: session.phone, text: message }),
    cache: "no-store",
  });

  if (!evoRes.ok) {
    const errBody = (await evoRes.json().catch(() => ({}))) as Record<string, unknown>;
    const msg = (errBody.message as string | undefined) ?? `Evolution erro ${evoRes.status}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Salva mensagem outbound
  const svc = createServiceClient();
  await svc.from("whatsapp_messages").insert({
    session_id: sessionId,
    clinic_id: session.clinic_id,
    direction: "outbound",
    body: message,
  });

  // Atualiza preview + marca que equipa está a atender (pausa o bot)
  await svc
    .from("whatsapp_sessions")
    .update({
      last_message_preview: message,
      updated_at: new Date().toISOString(),
      staff_handling: true,
      needs_human: false,
    })
    .eq("id", sessionId);

  return NextResponse.json({ ok: true });
}
