/**
 * Patch: muda a pergunta de nome de "Qual o seu nome?" → "Como posso te chamar?"
 * em todos os AI Agent nodes do workflow principal (kCX2).
 *
 * Aplica-se a dois padrões de systemMessage:
 *   Padrão A (AI Agent principal):
 *     old: '. Como posso te ajudar hoje? 😊') + '\"\\nE pergunte: \"Qual o seu nome?\"'
 *     new: '. Como posso te chamar? 😊') + '\"\\nFinalize SEMPRE com: Como posso te chamar?'
 *
 *   Padrão B (AI Agent de agendamento):
 *     old: '. Como posso te ajudar? 😊') + '\" e pergunte o nome.'
 *     new: '. Como posso te chamar? 😊') + '\" Finalize com: Como posso te chamar?'
 *
 * Lê credenciais de .cursor/mcp.json — sem hardcode.
 *
 * Uso:
 *   node n8n/patch-saudacao-chamar.mjs
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

// ── 1. Localizar o workflow pelo nome ────────────────────────────────────────
const listRes = await fetch(`${BASE}/workflows?limit=100`, { headers });
if (!listRes.ok) { console.error('LIST falhou', listRes.status, await listRes.text()); process.exit(1); }
const { data: workflows } = await listRes.json();

// Busca pelo workflow que contém "Code merge webhook e resolucao"
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

if (!targetWf) {
  console.error('Workflow com "Code merge webhook e resolucao" não encontrado.');
  process.exit(1);
}
console.log(`Workflow encontrado: "${targetWf.name}" (ID ${targetWf.id})`);

// ── 2. Substituições nos systemMessages ──────────────────────────────────────
const REPLACEMENTS = [
  {
    // Padrão A: AI Agent principal — fallback "ajudar hoje" + "E pergunte Qual o seu nome?"
    from: ". Como posso te ajudar hoje? \uD83D\uDE0A') + '\\\"\\\\nE pergunte: \\\"Qual o seu nome?\\\"'",
    to:   ". Como posso te chamar? \uD83D\uDE0A') + '\\\"\\\\nFinalize SEMPRE com: Como posso te chamar?'",
  },
  {
    // Padrão B: AI Agent de agendamento — fallback "ajudar?" + "e pergunte o nome."
    from: ". Como posso te ajudar? \uD83D\uDE0A') + '\\\" e pergunte o nome.'",
    to:   ". Como posso te chamar? \uD83D\uDE0A') + '\\\" Finalize com: Como posso te chamar?'",
  },
];

// Serializa o workflow inteiro como string e aplica as substituições
let wfStr = JSON.stringify(targetWf);
let totalChanges = 0;

for (const { from, to } of REPLACEMENTS) {
  const count = (wfStr.split(from).length - 1);
  if (count === 0) {
    // Padrão pode já ter sido aplicado ou não existir nesta versão
    console.log(`⚠️  Padrão não encontrado (pode já estar atualizado): "${from.slice(0, 60)}..."`);
    continue;
  }
  wfStr = wfStr.split(from).join(to);
  totalChanges += count;
  console.log(`✔  Substituído ${count}x: "${from.slice(0, 60)}..."`);
}

if (totalChanges === 0) {
  console.log('✅ Nenhuma alteração necessária — workflow já está atualizado.');
  process.exit(0);
}

// ── 3. Push ───────────────────────────────────────────────────────────────────
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

console.log(`\n✅ Workflow atualizado com sucesso! (${totalChanges} substituições)`);
console.log('Agora no primeiro contato o bot pergunta: "Como posso te chamar?"');
