/**
 * patch-fix-monta-contexto-v2.mjs
 * 
 * Corrige o bug crítico: o node "Monta Contexto" lia os dados da clínica
 * de $input (que vem de "Check First Contact" - apenas contagem de histórico)
 * em vez de $('Buscar Config Clínica') que é o node que realmente busca
 * agent_instructions, name, etc.
 */
import { readFileSync } from 'fs';

const mcp = JSON.parse(readFileSync('../.cursor/mcp.json', 'utf8'));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Código correto do Monta Contexto
// A mudança crucial: ler dados da clínica de $('Buscar Config Clínica') e não de $input
const CORRECT_CODE = `// Dados da clínica vêm de "Buscar Config Clínica" (não de $input que é o Check First Contact)
const clinicRaw = (() => {
  try {
    const r = $('Buscar Config Clínica').first().json;
    return Array.isArray(r) ? (r[0] || {}) : r;
  } catch { return {}; }
})();
const rawInstr = clinicRaw?.agent_instructions;
const clinic_name = clinicRaw?.name || '';

let agent_instructions = '';
let nome_agente = '';
let saudacao_novo = '';
let saudacao_retorno = '';
let instr_raw = {};

if (rawInstr) {
  try {
    const cfg = typeof rawInstr === 'string' ? JSON.parse(rawInstr) : rawInstr;
    nome_agente = cfg.nome_agente || '';
    saudacao_novo = cfg.saudacao_novo || '';
    saudacao_retorno = cfg.saudacao_retorno || '';
    instr_raw = cfg;
    const secoes = [
      { key: 'identidade', label: 'IDENTIDADE DO AGENTE' },
      { key: 'triagem',    label: 'TRIAGEM E URGENCIAS' },
      { key: 'tom',        label: 'TOM E LINGUAGEM' },
      { key: 'orientacoes',label: 'ORIENTACOES AO PACIENTE' },
      { key: 'transferir', label: 'QUANDO TRANSFERIR PARA HUMANO' },
      { key: 'outros',     label: 'OUTRAS INSTRUCOES' },
    ];
    agent_instructions = secoes
      .filter(s => typeof cfg[s.key] === 'string' && cfg[s.key].trim())
      .map(s => '### ' + s.label + '\\n' + cfg[s.key].trim())
      .join('\\n\\n');
  } catch(e) { agent_instructions = String(rawInstr); }
}

const clientRow = (() => {
  try {
    const r = $('Get Cliente').first().json;
    return Array.isArray(r) ? (r[0] || {}) : r;
  } catch { return {}; }
})();
const nome_cliente = (clientRow?.nome || '').trim();

let primeiro_contato = true;
try {
  const histRow = $('Check First Contact').first().json;
  const count = Number(histRow?.historico_count ?? 0);
  primeiro_contato = count === 0;
} catch { primeiro_contato = true; }

const mensagem = $('Edit Fields2').first().json.mensagem;
const clinic_id = $('Code merge webhook e resolucao').first().json.clinica_id;
const remoteJid = $('Webhook').first().json.body.data.key.remoteJid;
const instanceName = $('Edit Fields1').first().json.instanceName || '';

const _nowBR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
const _hr = _nowBR.getHours();
const saudacao_periodo = _hr >= 5 && _hr < 12 ? 'Bom dia' : _hr >= 12 && _hr < 18 ? 'Boa tarde' : 'Boa noite';
if (saudacao_novo) {
  saudacao_novo = saudacao_novo
    .replace(/{{periodo}}/g, saudacao_periodo)
    .replace(/{{name}}/g, nome_agente)
    .replace(/{{clinica}}/g, clinic_name);
}
if (agent_instructions) {
  agent_instructions = agent_instructions
    .replace(/{{name}}/g, nome_agente || '')
    .replace(/{{nome_agente}}/g, nome_agente || '')
    .replace(/{{agente}}/g, nome_agente || '')
    .replace(/{{clinica}}/g, clinic_name || '')
    .replace(/{{nome_clinica}}/g, clinic_name || '')
    .replace(/{{periodo}}/g, saudacao_periodo);
}

return [{ json: {
  mensagem,
  agent_instructions,
  nome_agente,
  clinic_name,
  nome_cliente,
  saudacao_novo,
  saudacao_retorno,
  saudacao_periodo,
  primeiro_contato,
  clinic_id,
  remoteJid,
  instanceName,
  instr_triagem:    instr_raw.triagem     || '',
  instr_faq:        instr_raw.orientacoes || '',
  instr_transferir: instr_raw.transferir  || '',
  instr_outros:     instr_raw.outros      || '',
} }];`;

// Busca o workflow ao vivo
const r = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, {
  headers: { 'X-N8N-API-KEY': apiKey }
});
const workflow = await r.json();

let patched = 0;
function patchNodes(nodeArr) {
  if (!Array.isArray(nodeArr)) return;
  for (const node of nodeArr) {
    if (node.name === 'Monta Contexto' && node.type === 'n8n-nodes-base.code') {
      const before = (node.parameters?.jsCode || '').slice(0, 80);
      node.parameters = { ...node.parameters, jsCode: CORRECT_CODE };
      const after = (node.parameters?.jsCode || '').slice(0, 80);
      console.log(`Patched node "${node.name}"`);
      console.log(`  Antes: "${before.replace(/\n/g, '↵')}..."`);
      console.log(`  Depois: "${after.replace(/\n/g, '↵')}..."`);
      patched++;
    }
  }
}

patchNodes(workflow.nodes);
patchNodes(workflow.activeVersion?.nodes);

if (patched === 0) {
  console.error('NENHUM node "Monta Contexto" encontrado!');
  process.exit(1);
}
console.log(`\n${patched} node(s) patched.`);

// Atualiza o workflow
const putBody = {
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: { executionOrder: workflow.settings?.executionOrder ?? 'v1' },
  staticData: workflow.staticData ?? undefined,
};

const putRes = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, {
  method: 'PUT',
  headers: {
    'X-N8N-API-KEY': apiKey,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(putBody),
});

console.log(`PUT ${putRes.ok ? 'OK' : 'ERRO'} ${putRes.status}`);
if (!putRes.ok) {
  const txt = await putRes.text();
  console.error(txt.slice(0, 500));
}
