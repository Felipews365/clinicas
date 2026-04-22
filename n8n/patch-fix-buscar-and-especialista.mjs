/**
 * Fix 1: agd_cs_buscar_agendamentos jsonBody
 *   - Replace static JSON string (with embedded n8n expression) with proper n8n expression
 *   - Use JSON.stringify pattern same as agd_cs_consultar_vagas
 *
 * Fix 2: agente_especialista_procedimentos system message
 *   - Add nome_cliente + primeiro_contato greeting logic (same as qualifica)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const WORKFLOW_ID = "kCX2LfxJrdYWB0vk";

// Load local workflow
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const workflow = JSON.parse(fs.readFileSync(wfPath, "utf8"));

// ─────────────────────────────────────────
// FIX 1: agd_cs_buscar_agendamentos body
// ─────────────────────────────────────────
const buscarNode = workflow.nodes.find(n => n.name === "agd_cs_buscar_agendamentos");
if (!buscarNode) throw new Error("agd_cs_buscar_agendamentos not found");

// Old body had: "p_clinic_id": "={{ $('Code merge ...').first().json.clinica_id }}"
// which is not evaluated inside toolHttpRequest jsonBody string.
// Fix: use specifyBody: "expression" pattern with JSON.stringify (same as consultar_vagas)
buscarNode.parameters.specifyBody = "json";
buscarNode.parameters.jsonBody = `={{ JSON.stringify({ p_telefone: '{telefone}', p_clinic_id: $('Code merge webhook e resolucao').first().json.clinica_id }) }}`;

console.log("✓ Fixed agd_cs_buscar_agendamentos jsonBody");
console.log("  New body:", buscarNode.parameters.jsonBody);

// ─────────────────────────────────────────
// FIX 2: agente_especialista_procedimentos — add greeting with client name
// ─────────────────────────────────────────
const espNode = workflow.nodes.find(n => n.name === "agente_especialista_procedimentos");
if (!espNode) throw new Error("agente_especialista_procedimentos not found");

const oldEspSM = espNode.parameters.options.systemMessage;

// Add identification block at top (same pattern as qualifica)
const greetingBlock = `=## IDENTIFICAÇÃO DO CLIENTE
Você é {{ $json.nome_agente || 'Assistente' }}, especialista em procedimentos da {{ $json.clinic_name || 'clínica' }}.
Data/hora: {{ $now.format('dd/MM/yyyy HH:mm') }}
Nome do cliente: {{ $json.nome_cliente || '(não informado)' }}

{{ $json.primeiro_contato
  ? ($json.nome_cliente
      ? '→ PRIMEIRO CONTATO. Cumprimente pelo nome: "' + ($json.saudacao_retorno || 'Olá, ' + $json.nome_cliente + '! Como posso te ajudar hoje? 😊') + '"'
      : '→ PRIMEIRO CONTATO (novo). Período: ' + $json.saudacao_periodo + '. Apresente-se: "' + ($json.saudacao_novo || 'Olá! Sou ' + ($json.nome_agente || 'Assistente') + ', da ' + ($json.clinic_name || 'clínica') + '. Como posso te chamar? 😊') + '"')
  : '→ CONVERSA EM ANDAMENTO. NÃO cumprimente novamente. Responda diretamente à dúvida.'
}}

`;

// Replace the old first line (which started with "=Você é ...")
const newEspSM = oldEspSM.replace(
  /^=Você é.*?\n/,
  greetingBlock
);

if (newEspSM === oldEspSM) {
  // fallback: prepend
  espNode.parameters.options.systemMessage = greetingBlock + oldEspSM.replace(/^=/, "");
  console.log("⚠ Used fallback prepend for especialista SM");
} else {
  espNode.parameters.options.systemMessage = newEspSM;
  console.log("✓ Fixed agente_especialista_procedimentos system message (greeting with client name)");
}

// ─────────────────────────────────────────
// Save local file
// ─────────────────────────────────────────
fs.writeFileSync(wfPath, JSON.stringify(workflow, null, 2));
console.log("\n✓ Saved workflow-kCX2-live.json");

// ─────────────────────────────────────────
// Push to n8n
// ─────────────────────────────────────────
console.log("\nPushing to n8n...");
const resp = await fetch(`${baseUrl}/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify(workflow),
});

if (!resp.ok) {
  const text = await resp.text();
  console.error("❌ Push failed:", resp.status, text.substring(0, 300));
  process.exit(1);
}

const result = await resp.json();
console.log("✓ Pushed successfully. Workflow updatedAt:", result.updatedAt);
