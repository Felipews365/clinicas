/**
 * Patch: adiciona saudação dinâmica por período do dia (Bom dia / Boa tarde / Boa noite)
 * ao workflow principal de atendimento WhatsApp.
 *
 * Mudanças aplicadas:
 *   1. Code node "Monta Contexto" → adiciona cálculo de saudacao_periodo (fuso Brasília)
 *      e substituição de {{periodo}}/{{name}}/{{clinica}} no saudacao_novo.
 *   2. systemMessages dos AI Agents → fallback e rótulo de instrução usam saudacao_periodo.
 *
 * Lê credenciais de .cursor/mcp.json — sem hardcode.
 *
 * Uso:
 *   node n8n/patch-periodo-saudacao.mjs
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

// ── 2. Código a inserir no Code node "Monta Contexto" ───────────────────────
const PERIODO_CODE = [
  '',
  'const _nowBR = new Date(new Date().toLocaleString(\'en-US\', { timeZone: \'America/Sao_Paulo\' }));',
  'const _hr = _nowBR.getHours();',
  'const saudacao_periodo = _hr >= 5 && _hr < 12 ? \'Bom dia\' : _hr >= 12 && _hr < 18 ? \'Boa tarde\' : \'Boa noite\';',
  'if (saudacao_novo) {',
  '  saudacao_novo = saudacao_novo',
  '    .replace(/{{periodo}}/g, saudacao_periodo)',
  '    .replace(/{{name}}/g, nome_agente)',
  '    .replace(/{{clinica}}/g, clinic_name);',
  '}',
].join('\n');

// Âncora: linha que precede o return no Code node
const ANCHOR_BEFORE_RETURN = "const instanceName = $('Edit Fields1').first().json.instanceName || '';";
// Marcador para detectar se o patch já foi aplicado
const PERIODO_MARKER = 'saudacao_periodo';

// ── 3. Substituições de string no JSON serializado ───────────────────────────
const REPLACEMENTS = [
  // --- Code node: inserir período antes do return ---
  {
    from: `${ANCHOR_BEFORE_RETURN}\\n\\nreturn [{ json: {\\n  mensagem,`,
    to:   `${ANCHOR_BEFORE_RETURN}${PERIODO_CODE.replace(/\n/g, '\\n')}\\n\\nreturn [{ json: {\\n  mensagem,`,
    desc: 'Code node: inserir cálculo de saudacao_periodo',
  },
  // --- Code node: adicionar saudacao_periodo ao return ---
  {
    from: `  saudacao_retorno,\\n  primeiro_contato,\\n  clinic_id,`,
    to:   `  saudacao_retorno,\\n  saudacao_periodo,\\n  primeiro_contato,\\n  clinic_id,`,
    desc: 'Code node: saudacao_periodo no return',
  },
  // --- systemMessage Tipo A: rótulo + fallback ---
  {
    from: `'→ PRIMEIRO CONTATO de CLIENTE NOVO. Apresente-se: \\"' + ($json.saudacao_novo || 'Olá! Sou ' + ($json.nome_agente || 'Assistente') + ', da ' + ($json.clinic_name`,
    to:   `'→ PRIMEIRO CONTATO de CLIENTE NOVO. Período: ' + $json.saudacao_periodo + '. Apresente-se: \\"' + ($json.saudacao_novo || 'Olá! ' + $json.saudacao_periodo + '! Sou ' + ($json.nome_agente || 'Assistente') + ', da ' + ($json.clinic_name`,
    desc: 'systemMessage Tipo A: período no rótulo + fallback',
  },
  // --- systemMessage Tipo B: rótulo + fallback ---
  {
    from: `'→ PRIMEIRO CONTATO (novo). Apresente-se: \\"' + ($json.saudacao_novo || 'Olá! Sou ' + ($json.nome_agente || 'Assistente') + ', da ' + ($json.clinic_name`,
    to:   `'→ PRIMEIRO CONTATO (novo). Período: ' + $json.saudacao_periodo + '. Apresente-se: \\"' + ($json.saudacao_novo || 'Olá! ' + $json.saudacao_periodo + '! Sou ' + ($json.nome_agente || 'Assistente') + ', da ' + ($json.clinic_name`,
    desc: 'systemMessage Tipo B: período no rótulo + fallback',
  },
];

let wfStr = JSON.stringify(targetWf);
let totalChanges = 0;

for (const { from, to, desc } of REPLACEMENTS) {
  const count = (wfStr.split(from).length - 1);
  if (count === 0) {
    // Verifica se já foi aplicado
    if (wfStr.includes(PERIODO_MARKER) && desc.includes('Code node: inserir')) {
      console.log(`⚠️  "${desc}" — já aplicado, pulando.`);
    } else {
      console.log(`⚠️  "${desc}" — padrão não encontrado (pode já estar atualizado).`);
    }
    continue;
  }
  wfStr = wfStr.split(from).join(to);
  totalChanges += count;
  console.log(`✔  (${count}x) ${desc}`);
}

if (totalChanges === 0) {
  console.log('\n✅ Nenhuma alteração necessária — workflow já está atualizado.');
  process.exit(0);
}

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

console.log(`\n✅ Workflow atualizado! (${totalChanges} substituições)`);
console.log('Agora o bot envia: "Olá! Boa tarde! Sou [agente], da [clínica]. Como posso te chamar? 😊"');
