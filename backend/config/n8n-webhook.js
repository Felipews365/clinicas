"use strict";

/**
 * Webhook de produção do fluxo n8n ligado ao repositório (Evolution → n8n).
 * Workflow: "Clinica atualizada" — ID alinhado com a instância self-hosted.
 */
const DEFAULT_N8N_HOST = "https://n8n.vps7846.panel.icontainer.cloud";
const WEBHOOK_PATH_PRODUCTION = "a9a0aa31-2d90-45ad-8da2-536c499768d8";

const N8N_WORKFLOW_ID = "kCX2LfxJrdYWB0vk";
const N8N_WORKFLOW_NAME = "Clinica atualizada";

/**
 * URL completa do webhook (path UUID do nó Webhook no fluxo).
 * Prioridade: N8N_WEBHOOK_URL → host N8N_PUBLIC_BASE_URL ou DEFAULT_N8N_HOST + path fixo.
 */
function resolveN8nWebhookUrl() {
  const explicit = (process.env.N8N_WEBHOOK_URL || "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const host = (process.env.N8N_PUBLIC_BASE_URL || DEFAULT_N8N_HOST).trim().replace(/\/+$/, "");
  return `${host}/webhook/${WEBHOOK_PATH_PRODUCTION}`;
}

module.exports = {
  resolveN8nWebhookUrl,
  N8N_WORKFLOW_ID,
  N8N_WORKFLOW_NAME,
  WEBHOOK_PATH_PRODUCTION,
  DEFAULT_N8N_HOST,
};
