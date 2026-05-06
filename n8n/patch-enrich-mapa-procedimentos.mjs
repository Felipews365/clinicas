/**
 * Adiciona ao Enrich Agendador um bloco "MAPA PROCEDIMENTO → PROFISSIONAIS APTOS"
 * calculado a partir dos dados de serviços e profissionais já carregados.
 *
 * Resolve o bug onde a mensagem curta do cliente ("as 10h", "sim") não dispara
 * a detecção de procedimento → lista de profissionais fica não-filtrada →
 * agente lista todos os profissionais independente de quem faz o procedimento.
 *
 * Uso: node n8n/patch-enrich-mapa-procedimentos.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");

const NEEDLE =
  "(ctx.agent_instructions || '') + catalogBridge + servicosBlock + profBlock + procedimentoFromMsgBlock,";

// O INSERT substitui apenas a linha de agent_instructions para adicionar mapaBlock
// O código do mapa é adicionado logo antes do return, usando String para evitar problemas de escaping
const MAPA_CODE = [
  "",
  "// Mapa procedimento → profissionais aptos (calculado a partir dos dados já carregados)",
  "let mapaBlock = '';",
  "try {",
  "  if (svcsM.length > 0 && typeof profs !== 'undefined' && Array.isArray(profs) && profs.length > 0) {",
  "    const linhasMapa = [];",
  "    for (const s of svcsM) {",
  "      if (!s.id || !s.nome) continue;",
  "      const aptos = [];",
  "      const semVinculos = [];",
  "      for (const p of profs) {",
  "        const pids = Array.isArray(p.procedimento_ids) ? p.procedimento_ids.map(String) : [];",
  "        if (pids.length === 0) {",
  "          semVinculos.push(String(p.nome || '?'));",
  "        } else if (pids.includes(String(s.id))) {",
  "          aptos.push(String(p.nome || '?'));",
  "        }",
  "      }",
  "      if (aptos.length > 0 || semVinculos.length > 0) {",
  "        const semHint = semVinculos.length ? '(' + semVinculos.join(', ') + ' – sem vínculo cadastrado, aceita qualquer procedimento)' : '';",
  "        const todos = [...aptos, ...(semHint ? [semHint] : [])];",
  "        linhasMapa.push('  - ' + s.nome + ' (servico_id: ' + s.id + '): ' + todos.join(', '));",
  "      }",
  "    }",
  "    if (linhasMapa.length > 0) {",
  "      mapaBlock =",
  "        '\\n\\n## MAPA PROCEDIMENTO → PROFISSIONAIS APTOS (referência obrigatória)\\n' +",
  "        '⚠️ USE ESTE MAPA para saber quais profissionais podem atender cada procedimento.\\n' +",
  "        'Antes de listar profissionais ou chamar agd_cs_consultar_vagas, identifique o procedimento desta conversa ' +",
  "        'e cite APENAS os profissionais listados para ele abaixo.\\n' +",
  "        linhasMapa.join('\\n') + '\\n';",
  "    }",
  "  }",
  "} catch (_mapaErr) { /* sem mapa – agent usa regras do SM */ }",
  "",
].join("\n");

const NEW_LINE =
  "(ctx.agent_instructions || '') + catalogBridge + servicosBlock + profBlock + mapaBlock + procedimentoFromMsgBlock,";

// Também precisamos injetar o código do mapa antes do `return [`
const RETURN_NEEDLE = "return [\n  {\n    json: {\n      ...ctx,\n      agent_instructions:";

function patchCode(code) {
  if (typeof code !== "string") return code;
  if (code.includes("MAPA PROCEDIMENTO → PROFISSIONAIS APTOS")) return code; // já aplicado
  if (!code.includes(NEEDLE)) return null;

  // 1. Substituir a linha agent_instructions para incluir mapaBlock
  let patched = code.replace(NEEDLE, NEW_LINE);

  // 2. Injetar o código do mapa antes do return [
  if (!patched.includes(RETURN_NEEDLE)) {
    console.warn("AVISO: âncora do return não encontrada – inserindo código do mapa antes da substituição da linha");
    return null;
  }
  patched = patched.replace(RETURN_NEEDLE, MAPA_CODE + RETURN_NEEDLE);

  return patched;
}

function walk(nodes) {
  let n = 0;
  if (!Array.isArray(nodes)) return 0;
  for (const node of nodes) {
    const isEnrich =
      node?.name === "Enrich Agendador" &&
      (node?.type === "@n8n/n8n-nodes-langchain.code" ||
        node?.type === "n8n-nodes-base.code");
    if (!isEnrich) continue;

    const code = node?.parameters?.jsCode;
    const next = patchCode(code);
    if (next === null) {
      console.warn("AVISO: âncora não encontrada no Enrich Agendador – verificar manualmente");
      continue;
    }
    if (next !== code) {
      node.parameters.jsCode = next;
      n++;
    }
  }
  return n;
}

const workflow = JSON.parse(readFileSync(wfPath, "utf8"));
let total = walk(workflow.nodes);
if (workflow.activeVersion?.nodes) total += walk(workflow.activeVersion.nodes);

if (total === 0) {
  console.error(
    "ERRO: nenhum patch aplicado. Verificar se o node 'Enrich Agendador' existe e a âncora bate."
  );
  process.exit(1);
}

writeFileSync(wfPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log(`Patch aplicado em ${total} node(s) Enrich Agendador → ${wfPath}`);
