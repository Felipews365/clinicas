import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { obterConfigEvolutionServidor } from "@/lib/env/evolution-server";
import { defaultN8nWebhookProductionUrl } from "@/lib/n8n-workflow";

const N8N_WEBHOOK = defaultN8nWebhookProductionUrl().trim().replace(/\/+$/, "");

function evoHeaders(apiKey: string) {
  return { "Content-Type": "application/json", apikey: apiKey };
}

/** Resposta do logout: a instância continua no Evolution; create falha se não tratarmos isso. */
function corpoIndicaInstanciaJaExiste(body: Record<string, unknown>): boolean {
  const msg = JSON.stringify(body).toLowerCase();
  return (
    msg.includes("already exists") ||
    msg.includes("already exist") ||
    msg.includes("instance already") ||
    msg.includes("duplicate") ||
    msg.includes("token already") ||
    msg.includes("já existe") ||
    msg.includes("name already")
  );
}

async function evolutionInstanciaJaExiste(
  evoUrl: string,
  apiKey: string,
  instanceName: string
): Promise<boolean> {
  try {
    const res = await fetch(`${evoUrl}/instance/fetchInstances`, {
      headers: { apikey: apiKey },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const raw: unknown = await res.json().catch(() => null);
    const list: Record<string, unknown>[] = Array.isArray(raw)
      ? (raw as Record<string, unknown>[])
      : raw && typeof raw === "object" && Array.isArray((raw as { instances?: unknown }).instances)
        ? ((raw as { instances: Record<string, unknown>[] }).instances ?? [])
        : [];
    return list.some((inst) => {
      const n = inst.instanceName ?? inst.name;
      return typeof n === "string" && n === instanceName;
    });
  } catch {
    return false;
  }
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

  let instanciaJaExistente = await evolutionInstanciaJaExiste(evoUrl, evoKey, instanceName);

  if (!instanciaJaExistente) {
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

    const errBody = (await createRes.json().catch(() => ({}))) as Record<string, unknown>;
    const conflitoCriacao =
      createRes.status === 409 || corpoIndicaInstanciaJaExiste(errBody);

    if (createRes.ok) {
      /* nova instância criada */
    } else if (conflitoCriacao) {
      instanciaJaExistente = true;
    } else {
      const msg =
        (typeof errBody.message === "string" && errBody.message) ||
        (typeof errBody.error === "string" && errBody.error) ||
        "Falha ao criar instância na Evolution API.";
      return NextResponse.json({ error: "EVOLUTION_ERROR", message: msg }, { status: 502 });
    }
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

  const qrcode = await fetchQR(evoUrl, evoKey, instanceName, instanciaJaExistente ? 3 : 6);

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
