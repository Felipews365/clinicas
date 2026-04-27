/**
 * Injeta no node Monta Contexto datas explícitas (America/Sao_Paulo) em agent_instructions
 * e nos campos json cal_* para o agente não confundir "amanhã" com datas erradas.
 *
 * Uso: node n8n/patch-monta-contexto-calendario.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");

const OLD_SNIP = `agent_instructions = (agent_instructions ? agent_instructions + String.fromCharCode(10,10) : '') + _horCal;

return [{ json: {
  mensagem,`;

const NEW_SNIP = `agent_instructions = (agent_instructions ? agent_instructions + String.fromCharCode(10,10) : '') + _horCal;

function _ymdSP(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function _brSP(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const y = d.getFullYear();
  return day + '/' + m + '/' + y;
}
const _diasSem = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const cal_hoje_ymd = _ymdSP(_nowBR);
const cal_hoje_br = _brSP(_nowBR);
const cal_hoje_weekday = _diasSem[_nowBR.getDay()];
const _amanhaSP = new Date(_nowBR);
_amanhaSP.setDate(_amanhaSP.getDate() + 1);
const cal_amanha_ymd = _ymdSP(_amanhaSP);
const cal_amanha_br = _brSP(_amanhaSP);
const cal_amanha_weekday = _diasSem[_amanhaSP.getDay()];
const _calBlock =
  String.fromCharCode(10, 10) +
  '### CALENDÁRIO OBRIGATÓRIO (America/Sao_Paulo)' +
  String.fromCharCode(10) +
  '- Hoje: ' +
  cal_hoje_weekday +
  ', ' +
  cal_hoje_br +
  ' — YYYY-MM-DD: ' +
  cal_hoje_ymd +
  String.fromCharCode(10) +
  '- Amanhã: ' +
  cal_amanha_weekday +
  ', ' +
  cal_amanha_br +
  ' — YYYY-MM-DD: ' +
  cal_amanha_ymd +
  String.fromCharCode(10) +
  'Se o cliente disser AMANHÃ → data_solicitada na tool agd_cs_consultar_vagas DEVE ser ' +
  cal_amanha_ymd +
  '. Proibido usar outra data. Ao escrever ao cliente use esta data: ' +
  cal_amanha_br +
  '.' +
  String.fromCharCode(10) +
  'Se o cliente disser HOJE → data_solicitada = ' +
  cal_hoje_ymd +
  '.';
agent_instructions = agent_instructions + _calBlock;

return [{ json: {
  mensagem,`;

const OLD_TAIL = `  instr_outros:     instr_raw.outros      || '',
} }];`;

const NEW_TAIL = `  instr_outros:     instr_raw.outros      || '',
  cal_hoje_ymd,
  cal_hoje_br,
  cal_hoje_weekday,
  cal_amanha_ymd,
  cal_amanha_br,
  cal_amanha_weekday,
} }];`;

function patchCode(js) {
  if (typeof js !== "string") return js;
  if (js.includes("function _ymdSP(d)")) return js;
  if (!js.includes(OLD_SNIP)) {
    console.warn("Monta Contexto: trecho esperado não encontrado (workflow mudou?)");
    return js;
  }
  if (!js.includes(OLD_TAIL)) return js;
  return js.replace(OLD_SNIP, NEW_SNIP).replace(OLD_TAIL, NEW_TAIL);
}

function walk(nodes, label) {
  let n = 0;
  if (!Array.isArray(nodes)) return 0;
  for (const node of nodes) {
    if (node?.name === "Monta Contexto" && node?.type === "n8n-nodes-base.code") {
      const next = patchCode(node.parameters?.jsCode);
      if (next !== node.parameters.jsCode) {
        node.parameters = node.parameters || {};
        node.parameters.jsCode = next;
        n++;
        console.log(`  ✓ ${label} Monta Contexto (${node.id})`);
      }
    }
  }
  return n;
}

const workflow = JSON.parse(readFileSync(wfPath, "utf8"));
let total = walk(workflow.nodes, "nodes");
if (workflow.activeVersion?.nodes) {
  total += walk(workflow.activeVersion.nodes, "activeVersion");
}

writeFileSync(wfPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log(`Monta Contexto: ${total} node(s) atualizados → ${wfPath}`);
