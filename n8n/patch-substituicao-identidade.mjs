/**
 * Patch: substitui {{name}}, {{clinica}}, {{periodo}} também em agent_instructions
 * (seção identidade e demais seções do agente), além do saudacao_novo que já era feito.
 *
 * Problema corrigido:
 *   O Code node "Monta Contexto" só substituía marcadores em saudacao_novo.
 *   O campo agent_instructions chegava ao AI Agent com {{name}} literal,
 *   fazendo o agente poder dizer "{{name}}" em vez do nome real.
 *
 * Lê credenciais de .cursor/mcp.json — sem hardcode.
 *
 * Uso:
 *   node n8n/patch-substituicao-identidade.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpPath = path.join(__dirname, '..', '.cursor', 'mcp.json');
const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
const BASE = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const KEY  = mcp.mcpServers.n8n.env.N8N_API_KEY;
const headers = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };

// ── 1. Localizar workflow ────────────────────────────────────────────────────
const listRes = await fetch(`${BASE}/workflows?limit=100`, { headers });
if (!listRes.ok) { console.error('LIST falhou', listRes.status); process.exit(1); }
const { data: workflows } = await listRes.json();

let targetWf = null;
for (const wf of workflows) {
  const res = await fetch(`${BASE}/workflows/${wf.id}`, { headers });
  if (!res.ok) continue;
  const full = await res.json();
  if (full.nodes?.some(n => n.name === 'Code merge webhook e resolucao')) {
    targetWf = full;
    break;
  }
}
if (!targetWf) { console.error('Workflow não encontrado.'); process.exit(1); }
console.log(`Workflow: "${targetWf.name}" (ID ${targetWf.id})`);

// ── 2. Bloco a inserir após o saudacao_novo existente ─────────────────────
// Âncora: final do bloco if (saudacao_novo) + início do return
const ANCHOR_FROM = `if (saudacao_novo) {\\n  saudacao_novo = saudacao_novo\\n    .replace(/{{periodo}}/g, saudacao_periodo)\\n    .replace(/{{name}}/g, nome_agente)\\n    .replace(/{{clinica}}/g, clinic_name);\\n}\\n\\nreturn [{ json: {\\n  mensagem,`;

const NEW_BLOCK = [
  `if (agent_instructions) {`,
  `  agent_instructions = agent_instructions`,
  `    .replace(/{{name}}/g, nome_agente || '')`,
  `    .replace(/{{nome_agente}}/g, nome_agente || '')`,
  `    .replace(/{{agente}}/g, nome_agente || '')`,
  `    .replace(/{{clinica}}/g, clinic_name || '')`,
  `    .replace(/{{nome_clinica}}/g, clinic_name || '')`,
  `    .replace(/{{periodo}}/g, saudacao_periodo);`,
  `}`,
].join('\\n');

const ANCHOR_TO = `if (saudacao_novo) {\\n  saudacao_novo = saudacao_novo\\n    .replace(/{{periodo}}/g, saudacao_periodo)\\n    .replace(/{{name}}/g, nome_agente)\\n    .replace(/{{clinica}}/g, clinic_name);\\n}\\n${NEW_BLOCK}\\n\\nreturn [{ json: {\\n  mensagem,`;

// ── 3. Aplicar substituição no JSON serializado ───────────────────────────
let wfStr = JSON.stringify(targetWf);

// Verifica se já foi aplicado
if (wfStr.includes('agent_instructions = agent_instructions')) {
  console.log('✅ Patch já aplicado. Nada a fazer.');
  process.exit(0);
}

const countBefore = (wfStr.split(ANCHOR_FROM).length - 1);
if (countBefore === 0) {
  console.error('❌ Âncora não encontrada — padrão pode ter mudado.');
  console.error('Âncora buscada:', ANCHOR_FROM.slice(0, 100));
  process.exit(1);
}

wfStr = wfStr.split(ANCHOR_FROM).join(ANCHOR_TO);
console.log(`✔  (${countBefore}x) Code node: substituição em agent_instructions adicionada`);

// ── 4. Push ───────────────────────────────────────────────────────────────────
const updated = JSON.parse(wfStr);
const body = {
  name:        updated.name,
  nodes:       updated.nodes,
  connections: updated.connections,
  settings:    { executionOrder: updated.settings?.executionOrder ?? 'v1' },
  staticData:  updated.staticData ?? undefined,
};

const putRes = await fetch(`${BASE}/workflows/${targetWf.id}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify(body),
});

if (!putRes.ok) {
  console.error('PUT falhou', putRes.status, (await putRes.text()).slice(0, 500));
  process.exit(1);
}

console.log(`\n✅ Workflow atualizado com sucesso!`);
console.log('Agora {{name}}, {{clinica}} e {{periodo}} são substituídos em toda a identidade do agente.');
