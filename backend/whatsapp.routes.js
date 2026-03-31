const express = require("express");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { validateEvolutionEnv } = require("./config/evolution-env");
const { HttpError } = require("./lib/http-error");
const logger = require("./lib/logger");
const { createEvolutionService } = require("./services/evolution.service");

const router = express.Router();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const STATUS_MAP = {
  checking_config: "checking_config",
  creating_instance: "creating_instance",
  configuring_webhook: "configuring_webhook",
  waiting_qrcode: "waiting_qrcode",
  connected: "connected",
  disconnected: "disconnected",
  error: "error",
};

function mapStatusToLegacy(status) {
  if (status === STATUS_MAP.connected) return "conectado";
  if (status === STATUS_MAP.waiting_qrcode) return "aguardando_qr";
  return "desconectado";
}

function clinicInstanceName(clinicId) {
  return `clinica-${clinicId}`;
}

function parseClinicId(req) {
  const clinicId = req.body?.clinicId || req.query?.clinicId || req.params?.id;
  if (!clinicId) {
    throw new HttpError(400, "INVALID_INPUT", "Campo obrigatório ausente: clinicId");
  }
  return String(clinicId);
}

async function getClinicById(clinicId) {
  const { data, error } = await supabase
    .from("clinics")
    .select("id, instancia_evolution, status_whatsapp")
    .eq("id", clinicId)
    .maybeSingle();

  if (error) throw new HttpError(500, "DB_READ_ERROR", "Erro ao buscar clínica.", { detail: error.message });
  if (!data) throw new HttpError(404, "CLINIC_NOT_FOUND", "Clínica não encontrada.");

  return data;
}

async function upsertWhatsappIntegration(payload) {
  const nowIso = new Date().toISOString();
  const row = {
    clinic_id: payload.clinicId,
    instance_name: payload.instanceName,
    instance_id: payload.instanceId || null,
    phone_number: payload.phoneNumber || null,
    status: payload.status,
    webhook_url: payload.webhookUrl,
    webhook_configured: Boolean(payload.webhookConfigured),
    last_qr_code: payload.qrcode || null,
    last_connection_at: payload.lastConnectionAt || null,
    updated_at: nowIso,
  };

  const { error } = await supabase
    .from("clinic_whatsapp_integrations")
    .upsert(row, { onConflict: "clinic_id" });

  if (error) {
    throw new HttpError(500, "DB_UPSERT_ERROR", "Erro ao salvar dados do WhatsApp.", {
      detail: error.message,
    });
  }
}

async function syncLegacyClinicFields(clinicId, status, instanceName) {
  const { error } = await supabase
    .from("clinics")
    .update({
      instancia_evolution: instanceName,
      status_whatsapp: mapStatusToLegacy(status),
    })
    .eq("id", clinicId);

  if (error) {
    logger.warn("legacy_clinic_sync_failed", {
      clinicId,
      detail: error.message,
    });
  }
}

function responseFromState(state) {
  return {
    instanceName: state.instanceName,
    instanceId: state.instanceId || null,
    status: state.status || STATUS_MAP.disconnected,
    phoneNumber: state.phoneNumber || null,
    qrcode: state.qrcode || null,
    webhookConfigured: Boolean(state.webhookConfigured),
    message: state.message,
  };
}

function getWebhookInstance(payload) {
  return (
    payload?.instance ||
    payload?.instanceName ||
    payload?.data?.instance ||
    payload?.data?.instanceName ||
    payload?.eventData?.instance ||
    payload?.eventData?.instanceName ||
    null
  );
}

function parseWebhookEvent(payload) {
  return (
    payload?.event ||
    payload?.eventType ||
    payload?.data?.event ||
    payload?.data?.eventType ||
    null
  );
}

function parseWebhookQr(payload) {
  return (
    payload?.data?.qrcode?.base64 ||
    payload?.data?.base64 ||
    payload?.qrcode?.base64 ||
    payload?.base64 ||
    payload?.data?.code ||
    payload?.code ||
    null
  );
}

function parseConnectionState(payload) {
  return (
    payload?.data?.state ||
    payload?.state ||
    payload?.data?.status ||
    payload?.status ||
    null
  );
}

function parseMessagePayload(payload) {
  const data = payload?.data || payload;
  const key = data?.key || {};
  const pushName = data?.pushName || data?.sender?.pushName || null;
  const remoteJid = key?.remoteJid || data?.remoteJid || data?.from || null;
  const fromMe = Boolean(key?.fromMe ?? data?.fromMe);
  const body =
    data?.message?.conversation ||
    data?.message?.extendedTextMessage?.text ||
    data?.message?.imageMessage?.caption ||
    data?.body ||
    null;

  return {
    remoteJid,
    fromMe,
    body,
    pushName,
  };
}

async function safeForwardWebhook(rawPayload, env) {
  const forwardUrl = env.N8N_WEBHOOK_URL;
  if (!forwardUrl || forwardUrl === env.EVOLUTION_WEBHOOK_URL) return;
  try {
    await axios.post(forwardUrl, rawPayload, { timeout: 8000 });
  } catch (error) {
    logger.warn("forward_webhook_failed", {
      detail: error?.response?.data || error.message,
    });
  }
}

async function handleConnect(req, res) {
  const clinicId = parseClinicId(req);
  const env = validateEvolutionEnv();
  const evolution = createEvolutionService(env);

  logger.info("whatsapp_connect_started", { clinicId });
  const clinic = await getClinicById(clinicId);
  const instanceName = clinic.instancia_evolution || clinicInstanceName(clinicId);

  const state = {
    instanceName,
    instanceId: null,
    status: STATUS_MAP.checking_config,
    phoneNumber: null,
    qrcode: null,
    webhookConfigured: false,
    message: "Configuração verificada.",
  };

  await upsertWhatsappIntegration({
    clinicId,
    ...state,
    webhookUrl: env.EVOLUTION_WEBHOOK_URL,
  });

  state.status = STATUS_MAP.creating_instance;
  state.message = clinic.instancia_evolution
    ? "Instância existente reutilizada."
    : "Criando instância na Evolution.";

  const createResult = clinic.instancia_evolution
    ? { alreadyExists: true, instanceName }
    : await evolution.createInstance(instanceName);

  state.instanceId = createResult.instanceId || state.instanceId;
  state.phoneNumber = createResult.phoneNumber || state.phoneNumber;

  state.status = STATUS_MAP.configuring_webhook;
  state.message = "Validando configuração de webhook.";
  const webhookResult = await evolution.ensureWebhook(instanceName);
  state.webhookConfigured = webhookResult.webhookConfigured;

  const connection = await evolution.getConnection(instanceName).catch(() => null);
  if (connection) {
    state.instanceId = connection.instanceId || state.instanceId;
    state.phoneNumber = connection.phoneNumber || state.phoneNumber;
    state.qrcode = connection.qrcode || null;
    state.status = connection.qrcode ? STATUS_MAP.waiting_qrcode : connection.status || STATUS_MAP.disconnected;
  } else {
    state.status = STATUS_MAP.disconnected;
  }

  if (state.status === STATUS_MAP.connected) {
    state.message = "Instância e webhook configurados com sucesso.";
  } else if (state.status === STATUS_MAP.waiting_qrcode) {
    state.message = "Escaneie o QR Code para conectar o WhatsApp.";
  } else {
    state.message = "Instância pronta. Aguardando conexão.";
  }

  await upsertWhatsappIntegration({
    clinicId,
    ...state,
    webhookUrl: env.EVOLUTION_WEBHOOK_URL,
    lastConnectionAt: state.status === STATUS_MAP.connected ? new Date().toISOString() : null,
  });
  await syncLegacyClinicFields(clinicId, state.status, instanceName);

  logger.info("whatsapp_connect_finished", {
    clinicId,
    instanceName,
    status: state.status,
    webhookConfigured: state.webhookConfigured,
  });

  return res.json(responseFromState(state));
}

async function handleStatus(req, res) {
  const clinicId = parseClinicId(req);
  const clinic = await getClinicById(clinicId);

  const { data, error } = await supabase
    .from("clinic_whatsapp_integrations")
    .select(
      "instance_name, instance_id, status, phone_number, last_qr_code, webhook_configured, webhook_url, last_connection_at"
    )
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "DB_READ_ERROR", "Erro ao consultar status do WhatsApp.", {
      detail: error.message,
    });
  }

  if (!data) {
    return res.json({
      instanceName: clinic.instancia_evolution || clinicInstanceName(clinicId),
      instanceId: null,
      status: STATUS_MAP.disconnected,
      phoneNumber: null,
      qrcode: null,
      webhookConfigured: false,
      message: "Nenhuma instância conectada para esta clínica.",
    });
  }

  return res.json({
    instanceName: data.instance_name,
    instanceId: data.instance_id,
    status: data.status,
    phoneNumber: data.phone_number,
    qrcode: data.last_qr_code,
    webhookConfigured: data.webhook_configured,
    message: data.status === STATUS_MAP.connected
      ? "WhatsApp conectado."
      : "Status atualizado.",
  });
}

async function handleEvolutionWebhook(req, res) {
  let env = null;
  try {
    env = validateEvolutionEnv();
    if (env.EVOLUTION_WEBHOOK_SECRET) {
      const token = req.headers["x-evolution-secret"] || req.headers.authorization;
      const rawToken = String(token || "").replace(/^Bearer\s+/i, "");
      if (rawToken !== env.EVOLUTION_WEBHOOK_SECRET) {
        logger.warn("webhook_secret_mismatch", { provided: Boolean(rawToken) });
      }
    }

    const payload = req.body || {};
    const event = parseWebhookEvent(payload);
    const instanceName = getWebhookInstance(payload);

    if (!event || !instanceName) {
      logger.warn("webhook_missing_event_or_instance", { payload });
      return res.status(200).json({ ok: true });
    }

    const { data: integration } = await supabase
      .from("clinic_whatsapp_integrations")
      .select("clinic_id, phone_number")
      .eq("instance_name", instanceName)
      .maybeSingle();

    if (!integration?.clinic_id) {
      logger.warn("webhook_unknown_instance", { event, instanceName });
      void safeForwardWebhook(payload, env);
      return res.status(200).json({ ok: true });
    }

    const clinicId = integration.clinic_id;
    const updates = {
      updated_at: new Date().toISOString(),
    };

    if (event === "QRCODE_UPDATED") {
      updates.status = STATUS_MAP.waiting_qrcode;
      updates.last_qr_code = parseWebhookQr(payload);
      await syncLegacyClinicFields(clinicId, STATUS_MAP.waiting_qrcode, instanceName);
    }

    if (event === "CONNECTION_UPDATE") {
      const state = String(parseConnectionState(payload) || "").toLowerCase();
      const mapped = state === "open" ? STATUS_MAP.connected : STATUS_MAP.disconnected;
      updates.status = mapped;
      updates.last_connection_at = mapped === STATUS_MAP.connected ? new Date().toISOString() : null;
      if (mapped === STATUS_MAP.connected) {
        updates.last_qr_code = null;
      }
      await syncLegacyClinicFields(clinicId, mapped, instanceName);
    }

    if (event === "MESSAGES_UPSERT") {
      const msg = parseMessagePayload(payload);
      if (!msg.fromMe && msg.remoteJid) {
        await supabase.from("whatsapp_sessions").upsert(
          {
            clinic_id: clinicId,
            phone: msg.remoteJid,
            last_message_preview: msg.body,
            needs_human: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "clinic_id,phone" }
        );
      }
    }

    const { error } = await supabase
      .from("clinic_whatsapp_integrations")
      .update(updates)
      .eq("clinic_id", clinicId);

    if (error) {
      logger.warn("webhook_db_update_failed", {
        event,
        clinicId,
        detail: error.message,
      });
    }

    if (event === "MESSAGES_UPSERT") {
      logger.info("webhook_message_received_for_ai", {
        clinicId,
        instanceName,
        hint: "message stored and ready for AI integration",
      });
    }

    void safeForwardWebhook(payload, env);
  } catch (error) {
    logger.error("webhook_processing_error", {
      detail: error?.response?.data || error.message,
    });
  }

  return res.status(200).json({ ok: true });
}

function sendError(res, error) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({
      error: error.code,
      message: error.message,
      details: error.details,
    });
  }

  const detail = error?.response?.data || error?.message || "Erro inesperado";
  logger.error("whatsapp_route_unhandled_error", { detail });
  return res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "Erro interno ao processar requisição de WhatsApp.",
  });
}

router.post("/whatsapp/connect", async (req, res) => {
  try {
    return await handleConnect(req, res);
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/whatsapp/status", async (req, res) => {
  try {
    return await handleStatus(req, res);
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/webhooks/evolution", async (req, res) => handleEvolutionWebhook(req, res));

router.post("/clinica/:id/conectar-whatsapp", async (req, res) => {
  try {
    return await handleConnect(req, res);
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/clinica/:id/status-whatsapp", async (req, res) => {
  try {
    return await handleStatus(req, res);
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
