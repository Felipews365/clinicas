import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clinicId = searchParams.get("clinicId")?.trim();

  if (!clinicId) {
    return NextResponse.json({ error: "BAD_REQUEST", message: "clinicId é obrigatório." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED", message: "Não autenticado." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("clinic_whatsapp_integrations")
    .select("status, webhook_configured, last_qr_code, last_connection_at, instance_name")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 });
  }

  // Sem registro → ainda não configurado
  if (!data) {
    return NextResponse.json({ status: "disconnected", webhookConfigured: false, qrcode: null });
  }

  return NextResponse.json({
    status: data.status,
    webhookConfigured: data.webhook_configured,
    qrcode: data.status === "waiting_qrcode" ? (data.last_qr_code ?? null) : null,
    message: data.status === "connected"
      ? `Conectado em ${data.last_connection_at ? new Date(data.last_connection_at).toLocaleString("pt-BR") : "data desconhecida"}`
      : null,
  });
}
