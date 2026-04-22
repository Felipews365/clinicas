/**
 * Normaliza o campo `mensagem` no nó "Monta Contexto" do workflow kCX2.
 *
 * Problema: quando a mensagem chega como JSON-string ({"msg":"..."}) ou como
 * null/undefined (áudio, imagem, status), o agente_agendador recebe um input
 * inválido → LLM produz tool calls malformados → "Received tool input did not
 * match expected schema ✖ Required → at ".
 *
 * Solução: sanear `mensagem` logo no Monta Contexto para garantir sempre
 * uma string de texto puro antes de passar para o agent.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const PATCH_MARKER = "// [PATCH: normalize mensagem]";

const node = data.nodes.find((n) => n.name === "Monta Contexto");
if (!node) {
  console.error("Node 'Monta Contexto' not found!");
  process.exit(1);
}

if (node.parameters.jsCode.includes(PATCH_MARKER)) {
  console.log("Patch already applied. Nothing to do.");
  process.exit(0);
}

// Old (single) line to replace:
const OLD = `const mensagem = $('Edit Fields2').first().json.mensagem;`;

// New block: normalize to plain text
const NEW = `${PATCH_MARKER}
// Pega mensagem e normaliza: nunca deixa null/undefined/JSON-string chegar ao agent.
let _rawMsg;
try { _rawMsg = $('Edit Fields2').first().json.mensagem; } catch { _rawMsg = null; }
// Fallback 1: Edit Fields1.msg (texto extraído do webhook)
if (_rawMsg == null || _rawMsg === '') {
  try { _rawMsg = $('Edit Fields1').first().json.msg || ''; } catch { _rawMsg = ''; }
}
// Fallback 2: campo conversation direto do webhook
if (!_rawMsg) {
  try { _rawMsg = $('Webhook').first().json.body?.data?.message?.conversation || ''; } catch { _rawMsg = ''; }
}
// Se ainda for JSON-string, extrai o texto
let mensagem = '';
if (typeof _rawMsg === 'string') {
  const _trimmed = _rawMsg.trim();
  if (_trimmed.startsWith('{') || _trimmed.startsWith('[')) {
    try {
      const _parsed = JSON.parse(_trimmed);
      mensagem = String(_parsed.msg || _parsed.mensagem || _parsed.text || _parsed.message || _parsed.Mensagens || _trimmed);
    } catch { mensagem = _trimmed; }
  } else {
    mensagem = _trimmed;
  }
} else if (_rawMsg != null) {
  mensagem = String(_rawMsg);
}`;

if (!node.parameters.jsCode.includes(OLD)) {
  console.error("Expected string not found in jsCode – aborting to avoid corruption.");
  console.error("Expected:", OLD);
  process.exit(1);
}

node.parameters.jsCode = node.parameters.jsCode.replace(OLD, NEW);
console.log("✓ Monta Contexto jsCode patched.");

// Write back
fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log("✓ workflow-kCX2-live.json saved.");

// Push to n8n API
const mcpPath = path.join(__dirname, "..", ".cursor", "mcp.json");
const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const workflowId = data.id;

console.log(`Pushing to n8n workflow ${workflowId}...`);

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
  connections: data.connections ?? current.connections,
  settings: {
    executionOrder: current.settings?.executionOrder ?? "v1",
  },
  staticData: current.staticData ?? undefined,
};

const putRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  method: "PUT",
  headers: {
    "X-N8N-API-KEY": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});
const text = await putRes.text();
if (!putRes.ok) {
  console.error("PUT failed", putRes.status, text);
  process.exit(1);
}
console.log("✓ Workflow pushed to n8n:", putRes.status, text.slice(0, 200));
