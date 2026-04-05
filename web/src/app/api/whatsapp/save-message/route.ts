import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Chamado pelo n8n para persistir mensagens inbound no histórico.
 * Autenticado por secret compartilhado (WHATSAPP_WEBHOOK_SECRET).
 *
 * Body esperado:
 *   { clinic_id, phone, body, direction? }
 * direction padrão = "inbound"
 */
export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (secret) {
    const auth = req.headers.get("x-webhook-secret") ?? "";
    if (auth !== secret) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
  }

  let body: {
    clinic_id?: string;
    phone?: string;
    body?: string;
    direction?: "inbound" | "outbound";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const clinicId = body.clinic_id?.trim();
  const phone = body.phone?.trim();
  const text = body.body?.trim();
  const direction = body.direction ?? "inbound";

  if (!clinicId || !phone || !text) {
    return NextResponse.json(
      { error: "clinic_id, phone e body são obrigatórios" },
      { status: 400 }
    );
  }

  const svc = createServiceClient();

  // Upsert na sessão (cria se não existir)
  const { data: session, error: sesErr } = await svc
    .from("whatsapp_sessions")
    .upsert(
      {
        clinic_id: clinicId,
        phone,
        last_message_preview: text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id,phone" }
    )
    .select("id")
    .maybeSingle();

  if (sesErr || !session) {
    // Tenta buscar a sessão existente
    const { data: existing } = await svc
      .from("whatsapp_sessions")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("phone", phone)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json(
        { error: sesErr?.message ?? "Falha ao criar sessão" },
        { status: 500 }
      );
    }

    await svc.from("whatsapp_messages").insert({
      session_id: existing.id,
      clinic_id: clinicId,
      direction,
      body: text,
    });

    return NextResponse.json({ ok: true });
  }

  await svc.from("whatsapp_messages").insert({
    session_id: session.id,
    clinic_id: clinicId,
    direction,
    body: text,
  });

  return NextResponse.json({ ok: true });
}
