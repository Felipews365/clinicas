/**
 * Metadados do fluxo n8n usado pelo WhatsApp (Evolution).
 * Manter alinhado com backend/config/n8n-webhook.js.
 */
export const N8N_CONSULTORIO_WORKFLOW = {
  id: "kCX2LfxJrdYWB0vk",
  name: "Clinica atualizada",
} as const;

export const N8N_WEBHOOK_PATH_PRODUCTION = "a9a0aa31-2d90-45ad-8da2-536c499768d8";
export const N8N_WEBHOOK_PATH_TEST = "a9a0aa31-2d90-45ad-8da2-536c499768d8-test";

const DEFAULT_HOST = "https://n8n.vps7846.panel.icontainer.cloud";

/** URL de produção quando `N8N_WEBHOOK_URL` não está definida (mesma regra que o Express). */
export function defaultN8nWebhookProductionUrl(): string {
  const envFull = (process.env.N8N_WEBHOOK_URL ?? "").trim().replace(/\/+$/, "");
  if (envFull) return envFull;
  const host = (process.env.N8N_PUBLIC_BASE_URL ?? DEFAULT_HOST).trim().replace(/\/+$/, "");
  return `${host}/webhook/${N8N_WEBHOOK_PATH_PRODUCTION}`;
}
