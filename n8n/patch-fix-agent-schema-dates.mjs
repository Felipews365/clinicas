/**
 * Fix: "Received tool input did not match expected schema"
 *
 * Root causes addressed:
 * 1. System message lacks explicit date-conversion rules — LLM may pass "amanhã" to
 *    cs_consultar_vagas which expects YYYY-MM-DD, or (worse) call the tool without a
 *    date, leaving profissional_id or data_solicitada as null → schema mismatch.
 *
 * 2. System message doesn't explain how to handle multiple professionals — LLM may
 *    try to call cs_consultar_vagas with two IDs at once (invalid) or pass {} as args.
 *
 * 3. agd_cs_consultar_vagas placeholder descriptions don't block relative date strings.
 *
 * Changes:
 * A. Add current date in YYYY-MM-DD format to agente_agendador's system message header.
 * B. Insert ## DATAS section with explicit conversion rules.
 * C. Insert ## MÚLTIPLOS PROFISSIONAIS section.
 * D. Strengthen agd_cs_consultar_vagas placeholder descriptions.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

// ─────────────────────────────────────────────────────────────
// A + B + C: Update agente_agendador system message
// ─────────────────────────────────────────────────────────────
const aa = data.nodes.find((n) => n.name === "agente_agendador");
if (!aa) { console.error("agente_agendador not found"); process.exit(1); }

const OLD_HEADER = `=Você é {{ $json.nome_agente || 'Assistente' }}, responsável por agendamentos da {{ $json.clinic_name || 'clínica' }}.
Nome do cliente: {{ $json.nome_cliente || '(não informado)' }}
Telefone (p_telefone): {{ $json.remoteJid }}
Data/hora atual (apenas referência interna): {{ $now.format('dd/MM/yyyy HH:mm') }}`;

const NEW_HEADER = `=Você é {{ $json.nome_agente || 'Assistente' }}, responsável por agendamentos da {{ $json.clinic_name || 'clínica' }}.
Nome do cliente: {{ $json.nome_cliente || '(não informado)' }}
Telefone (p_telefone): {{ $json.remoteJid }}
Data/hora atual: {{ $now.format('dd/MM/yyyy HH:mm') }} — em YYYY-MM-DD: {{ $now.format('yyyy-MM-dd') }}`;

const OLD_RULES_ANCHOR = `## REGRAS
- NUNCA invente horários, serviços ou profissionais não retornados pelas tools`;

const NEW_SECTIONS_BEFORE_RULES = `## DATAS
NUNCA passe datas relativas ("amanhã", "hoje", "segunda", etc.) diretamente para tools.
SEMPRE converta para YYYY-MM-DD antes de chamar qualquer tool:
- "hoje" → use a data YYYY-MM-DD informada acima
- "amanhã" → data acima + 1 dia
- "depois de amanhã" → data acima + 2 dias
- Dias da semana → calcule o próximo dia correspondente a partir de hoje
Se não tiver certeza da data, escreva o resultado da conversão explicitamente na sua resposta antes de chamar a tool.

## MÚLTIPLOS PROFISSIONAIS
Quando o cliente pede horários de MAIS DE UM profissional:
1. Chame cs_consultar_profissionais para obter todos os IDs
2. Pergunte a data desejada (apenas uma vez)
3. Chame cs_consultar_vagas UMA VEZ por profissional (com o profissional_id de cada um) — NUNCA passe dois IDs ao mesmo tempo
4. Apresente os horários separados por profissional

## REGRAS
- NUNCA invente horários, serviços ou profissionais não retornados pelas tools`;

if (!aa.parameters.options.systemMessage.includes("## DATAS")) {
  aa.parameters.options.systemMessage = aa.parameters.options.systemMessage
    .replace(OLD_HEADER, NEW_HEADER)
    .replace(OLD_RULES_ANCHOR, NEW_SECTIONS_BEFORE_RULES);
  console.log("✓ agente_agendador: system message updated (DATAS + MÚLTIPLOS PROFISSIONAIS sections added).");
} else {
  console.log("✓ agente_agendador: ## DATAS section already present — skipping system message update.");
}

// ─────────────────────────────────────────────────────────────
// D: Strengthen agd_cs_consultar_vagas placeholder descriptions
// ─────────────────────────────────────────────────────────────
const vagas = data.nodes.find((n) => n.name === "agd_cs_consultar_vagas");
if (!vagas) { console.error("agd_cs_consultar_vagas not found"); process.exit(1); }

const ph = vagas.parameters.placeholderDefinitions?.values || [];
const dataPlaceholder = ph.find((p) => p.name === "data_solicitada");
const profPlaceholder = ph.find((p) => p.name === "profissional_id");

if (dataPlaceholder) {
  dataPlaceholder.description =
    "Data desejada OBRIGATORIAMENTE no formato YYYY-MM-DD (ex: 2026-04-22). " +
    "NUNCA passe strings relativas como 'amanhã', 'hoje' ou 'segunda'. " +
    "Converta ANTES de chamar esta tool.";
  console.log("✓ agd_cs_consultar_vagas: data_solicitada description updated.");
}

if (profPlaceholder) {
  profPlaceholder.description =
    "UUID exato do profissional retornado por cs_consultar_profissionais. " +
    "OBRIGATÓRIO — nunca passe null, vazio ou múltiplos IDs. " +
    "Chame esta tool UMA VEZ por profissional.";
  console.log("✓ agd_cs_consultar_vagas: profissional_id description updated.");
}

// ─────────────────────────────────────────────────────────────
// Save
// ─────────────────────────────────────────────────────────────
fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log("✓ workflow-kCX2-live.json saved.");

// ─────────────────────────────────────────────────────────────
// Push to n8n
// ─────────────────────────────────────────────────────────────
const mcpPath = path.join(__dirname, "..", ".cursor", "mcp.json");
const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const workflowId = data.id;

console.log(`\nPushing workflow ${workflowId} to n8n...`);

const getRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
if (!getRes.ok) {
  console.error("GET failed", getRes.status, await getRes.text());
  process.exit(1);
}
const current = await getRes.json();

const body = {
  name: data.name ?? current.name,
  nodes: data.nodes,
  connections: data.connections,
  settings: { executionOrder: current.settings?.executionOrder ?? "v1" },
  staticData: current.staticData ?? undefined,
};

const putRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await putRes.text();
if (!putRes.ok) {
  console.error("PUT failed", putRes.status, text);
  process.exit(1);
}
console.log("✓ Workflow pushed to n8n:", putRes.status, text.slice(0, 200));
