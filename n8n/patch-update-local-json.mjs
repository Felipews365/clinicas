/**
 * Atualiza os arquivos JSON locais com o código correto do Monta Contexto (v3)
 * Referência: $('Buscar Config Cl?nica') com ? literal
 */
import { readFileSync, writeFileSync } from 'fs';

const CORRECT_CODE = `// Dados da clínica vêm de "Buscar Config Cl?nica" (nome real do node — ? = í corrompido)
const clinicRaw = (() => {
  try {
    const r = $('Buscar Config Cl?nica').first().json;
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

const files = ['workflow-kCX2-live.json', 'workflow-kCX2-multi-agent.json'];

for (const filename of files) {
  try {
    const content = readFileSync(filename, 'utf8');
    const wf = JSON.parse(content);
    const nodes = wf.nodes || [];
    let patched = 0;

    function patchNodes(arr) {
      if (!Array.isArray(arr)) return;
      for (const node of arr) {
        if (node.name === 'Monta Contexto' && node.type === 'n8n-nodes-base.code') {
          node.parameters = { ...node.parameters, jsCode: CORRECT_CODE };
          patched++;
        }
      }
    }

    patchNodes(nodes);
    patchNodes(wf.activeVersion?.nodes);

    if (patched > 0) {
      writeFileSync(filename, JSON.stringify(wf, null, 2), 'utf8');
      console.log(`${filename}: ${patched} node(s) atualizados.`);
    } else {
      console.log(`${filename}: node não encontrado.`);
    }
  } catch (e) {
    console.error(`${filename}: erro - ${e.message}`);
  }
}
