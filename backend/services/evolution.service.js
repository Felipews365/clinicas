const axios = require("axios");

const WEBHOOK_EVENTS = [
  "QRCODE_UPDATED",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "MESSAGES_DELETE",
  "SEND_MESSAGE",
  "CONNECTION_UPDATE",
];

function safeLower(value) {
  return String(value || "").toLowerCase();
}

function normalizeStatus(rawStatus) {
  const value = safeLower(rawStatus);
  if (value.includes("open") || value.includes("connected")) return "connected";
  if (value.includes("close") || value.includes("disconnect")) return "disconnected";
  if (value.includes("qr") || value.includes("waiting")) return "waiting_qrcode";
  return "disconnected";
}

function normalizeInstancePayload(payload, fallbackInstanceName) {
  const instance = payload?.instance || payload?.data?.instance || payload?.response?.instance || payload || {};
  const instanceName =
    instance.instanceName ||
    instance.name ||
    payload?.instanceName ||
    payload?.name ||
    fallbackInstanceName;

  const instanceId =
    instance.instanceId ||
    instance.id ||
    payload?.instanceId ||
    payload?.id ||
    null;

  const phoneNumber =
    instance.ownerJid ||
    instance.wuid ||
    instance.number ||
    payload?.phoneNumber ||
    null;

  const status = normalizeStatus(
    instance.state || instance.status || payload?.state || payload?.status
  );

  return {
    instanceName,
    instanceId,
    phoneNumber,
    status,
  };
}

function extractQrCode(payload) {
  const qrcode = payload?.qrcode || payload?.data?.qrcode || {};
  return (
    payload?.base64 ||
    payload?.code ||
    qrcode?.base64 ||
    qrcode?.code ||
    payload?.qrCode ||
    null
  );
}

function getWebhookConfig(payload) {
  const data = payload?.webhook || payload?.data || payload || {};
  const webhookUrl = data?.url || data?.webhookUrl || null;
  const events = Array.isArray(data?.events) ? data.events : [];
  return {
    webhookUrl,
    events,
  };
}

function webhookMatches(config, expectedUrl) {
  if (!config?.webhookUrl) return false;
  if (String(config.webhookUrl).trim() !== String(expectedUrl).trim()) return false;
  const existing = new Set((config.events || []).map((event) => String(event).trim().toUpperCase()));
  return WEBHOOK_EVENTS.every((event) => existing.has(event));
}

function createEvolutionService(env) {
  const client = axios.create({
    baseURL: env.EVOLUTION_API_URL,
    headers: {
      "Content-Type": "application/json",
      apikey: env.EVOLUTION_API_KEY,
    },
    timeout: 15000,
  });

  async function createInstance(instanceName) {
    const payload = {
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      webhook: {
        url: env.EVOLUTION_WEBHOOK_URL,
        byEvents: true,
        events: WEBHOOK_EVENTS,
      },
    };

    try {
      const { data } = await client.post("/instance/create", payload);
      return {
        alreadyExists: false,
        ...normalizeInstancePayload(data, instanceName),
      };
    } catch (error) {
      if (error?.response?.status === 409) {
        return {
          alreadyExists: true,
          instanceName,
          instanceId: null,
          phoneNumber: null,
          status: "disconnected",
        };
      }
      throw error;
    }
  }

  async function getConnection(instanceName) {
    const { data } = await client.get(`/instance/connect/${instanceName}`);
    const normalized = normalizeInstancePayload(data, instanceName);
    return {
      ...normalized,
      qrcode: extractQrCode(data),
    };
  }

  async function getWebhook(instanceName) {
    const { data } = await client.get(`/webhook/find/${instanceName}`);
    return getWebhookConfig(data);
  }

  async function setWebhook(instanceName) {
    const payload = {
      webhook: {
        url: env.EVOLUTION_WEBHOOK_URL,
        byEvents: true,
        events: WEBHOOK_EVENTS,
      },
    };
    await client.post(`/webhook/set/${instanceName}`, payload);
  }

  async function ensureWebhook(instanceName) {
    const current = await getWebhook(instanceName).catch(() => null);
    if (current && webhookMatches(current, env.EVOLUTION_WEBHOOK_URL)) {
      return { webhookConfigured: true };
    }
    await setWebhook(instanceName);
    const validated = await getWebhook(instanceName).catch(() => null);
    return {
      webhookConfigured: webhookMatches(validated, env.EVOLUTION_WEBHOOK_URL),
    };
  }

  return {
    createInstance,
    getConnection,
    ensureWebhook,
    normalizeStatus,
    normalizeInstancePayload,
    extractQrCode,
  };
}

module.exports = {
  createEvolutionService,
  WEBHOOK_EVENTS,
};
