import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { obterConfigEvolutionServidor } from "@/lib/env/evolution-server";

type EvolutionConnectionPayload = {
  instance?: { state?: string; status?: string; wuid?: string; owner?: string };
  state?: string;
};

function cabecalhosEvo(apiKey: string): HeadersInit {
  return { apikey: apiKey };
}

async function consultarEstadoEvolution(
  evoUrl: string,
  apiKey: string,
  instanceName: string
): Promise<{ estado: string; telefone: string | null; instanciaExiste: boolean }> {
  const url = `${evoUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`;
  const res = await fetch(url, {
    headers: cabecalhosEvo(apiKey),
    cache: "no-store",
  });

  if (!res.ok) {
    return { estado: "", telefone: null, instanciaExiste: res.status !== 404 };
  }

  const raw = (await res.json().catch(() => ({}))) as EvolutionConnectionPayload & Record<string, unknown>;
  const inst = (raw.instance as Record<string, unknown> | undefined) ?? raw;
  const estado = String(inst?.state ?? inst?.status ?? raw.state ?? "").toLowerCase();

  const jid =
    (inst?.wuid as string | undefined) ??
    (inst?.owner as string | undefined) ??
    (raw.wuid as string | undefined) ??
    null;
  const telefone = jid ? (jid.split("@")[0] ?? jid) : null;

  return { estado, telefone, instanciaExiste: true };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clinicId = searchParams.get("clinicId")?.trim();

  if (!clinicId) {
    return NextResponse.json({ error: "BAD_REQUEST", message: "clinicId é obrigatório." }, { status: 400 });
  }

  // Auth via sessão; leitura/escrita via service role (RLS bloqueia usuários normais)
  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED", message: "Não autenticado." }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("clinic_whatsapp_integrations")
    .select("status, webhook_configured, last_qr_code, last_connection_at, instance_name")
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ status: "disconnected", webhookConfigured: false, qrcode: null });
  }

  let statusAtual = data.status;
  let lastQr = data.last_qr_code;
  let lastConnAt = data.last_connection_at;

  const evo = obterConfigEvolutionServidor();
  if (evo.valido && data.instance_name) {
    const { estado, telefone, instanciaExiste } = await consultarEstadoEvolution(
      evo.config.url,
      evo.config.apiKey,
      data.instance_name
    );

    // Instância foi deletada na Evolution — reseta para que o usuário gere um novo QR
    if (!instanciaExiste && (statusAtual === "waiting_qrcode" || statusAtual === "connected")) {
      await supabase
        .from("clinic_whatsapp_integrations")
        .update({ status: "disconnected", last_qr_code: null })
        .eq("clinic_id", clinicId);
      return NextResponse.json({ status: "disconnected", webhookConfigured: data.webhook_configured, qrcode: null });
    }

    if (estado === "open") {
      const agora = new Date().toISOString();
      const novoLastConn = statusAtual === "connected" && data.last_connection_at ? data.last_connection_at : agora;
      const patch: Record<string, unknown> = {
        status: "connected",
        last_connection_at: novoLastConn,
        last_qr_code: null,
      };
      if (telefone) patch.phone_number = telefone;

      await supabase.from("clinic_whatsapp_integrations").update(patch).eq("clinic_id", clinicId);

      statusAtual = "connected";
      lastQr = null;
      lastConnAt = novoLastConn;
    } else if (estado === "close" || estado === "closed") {
      // Só derruba para "disconnected" se estava "connected" — estado "close" é normal
      // enquanto aguarda o escaneamento do QR code ("waiting_qrcode").
      if (statusAtual === "connected") {
        await supabase
          .from("clinic_whatsapp_integrations")
          .update({ status: "disconnected", last_qr_code: null })
          .eq("clinic_id", clinicId);
        statusAtual = "disconnected";
        lastQr = null;
      }
    }
  }

  return NextResponse.json({
    status: statusAtual,
    webhookConfigured: data.webhook_configured,
    qrcode: statusAtual === "waiting_qrcode" ? (lastQr ?? null) : null,
    message:
      statusAtual === "connected"
        ? `Conectado em ${
            lastConnAt ? new Date(lastConnAt).toLocaleString("pt-BR") : "data desconhecida"
          }`
        : null,
  });
}
