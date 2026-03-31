import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { obterConfigEvolutionServidor } from "@/lib/env/evolution-server";

const N8N_WEBHOOK = (process.env.N8N_WEBHOOK_URL ?? "").trim().replace(/\/+$/, "");

function evoHeaders(apiKey: string) {
  return { "Content-Type": "application/json", apikey: apiKey };
}

async function fetchQR(
  evoUrl: string,
  apiKey: string,
  instanceName: string,
  tries = 6,
  delay = 1500
): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${evoUrl}/instance/connect/${instanceName}`, {
        headers: evoHeaders(apiKey),
        cache: "no-store",
      });
      if (res.ok) {
        const d = (await res.json()) as Record<string, unknown>;
        const qr =
          (d.base64 as string | undefined) ??
          ((d.qrcode as Record<string, unknown> | undefined)?.base64 as string | undefined) ??
          (d.code as string | undefined) ??
          null;
        if (qr) return qr;
      }
    } catch {
      /* tenta de novo */
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delay));
  }
  return null;
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

  const { url: evoUrl, apiKey: evoKey } = evo.config;

  if (!N8N_WEBHOOK) {
    return NextResponse.json(
      {
        error: "MISSING_SERVER_CONFIG",
        missing: ["N8N_WEBHOOK_URL"],
        message:
          "N8N_WEBHOOK_URL não está definida ou está vazia em web/.env.local. É necessária para o webhook da instância Evolution. Reinicie o servidor Next.js após alterar.",
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

  const instanceName = `clinica-${clinicId}`;
  const webhookUrl = N8N_WEBHOOK;

  const createRes = await fetch(`${evoUrl}/instance/create`, {
    method: "POST",
    headers: evoHeaders(evoKey),
    body: JSON.stringify({
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      webhook: {
        url: webhookUrl,
        byEvents: false,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
      },
    }),
    cache: "no-store",
  });

  const alreadyExists = createRes.status === 409;
  if (!createRes.ok && !alreadyExists) {
    const err = (await createRes.json().catch(() => ({}))) as { message?: string };
    return NextResponse.json(
      { error: "EVOLUTION_ERROR", message: err.message ?? "Falha ao criar instância na Evolution API." },
      { status: 502 }
    );
  }

  const webhookConfigured = true;
  await supabase.from("clinic_whatsapp_integrations").upsert(
    {
      clinic_id: clinicId,
      instance_name: instanceName,
      status: "waiting_qrcode",
      webhook_url: webhookUrl,
      webhook_configured: webhookConfigured,
    },
    { onConflict: "clinic_id" }
  );

  const qrcode = await fetchQR(evoUrl, evoKey, instanceName, alreadyExists ? 3 : 6);

  if (qrcode) {
    await supabase.from("clinic_whatsapp_integrations").update({ last_qr_code: qrcode }).eq("clinic_id", clinicId);
  }

  return NextResponse.json({
    status: "waiting_qrcode",
    qrcode,
    webhookConfigured,
    message: qrcode ? "QR Code pronto. Escaneie com o WhatsApp." : "Instância criada. QR ainda sendo gerado.",
  });
}
