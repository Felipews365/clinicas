/**
 * Insere regras de UX: não enviar grade completa; perguntar profissional primeiro.
 * Uso: node n8n/patch-agendador-sm-vagas-curtas.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");

const NEEDLE =
  "## FORMATAÇÃO\nNUNCA escreva listas em linha corrida. SEMPRE use quebra de linha para cada item.\n\n## FLUXO NOVO AGENDAMENTO";

const INSERT = `## FORMATAÇÃO
NUNCA escreva listas em linha corrida. SEMPRE use quebra de linha para cada item.

## VAGAS — MENSAGENS CURTAS (obrigatório)
- **Proibido** enviar a grade completa do dia (cada horário com todos os profissionais) numa única mensagem.
- Depois de chamar agd_cs_consultar_vagas: se o cliente **ainda não** escolheu **com qual profissional** quer agendar, responda **só** com uma pergunta curta, por exemplo: *"Com qual profissional você gostaria de agendar?"* e cite **apenas os nomes** (lista breve, **sem** horários).
- **Somente depois** que o cliente indicar o profissional: liste **apenas os horários desse** profissional (filtre o JSON por nome ou profissional_id). Máximo **10** horários por mensagem; se houver mais, pergunte se prefere **manhã** ou **tarde** e estreite.
- Se o cliente **já** tiver dito o profissional antes de pedir o dia, pode listar direto os horários **dele** (ainda assim, sem repetir toda a clínica).
- Se o cliente pedir um horário fixo (ex. 14h), responda **curto**: se há vaga ou não **para o profissional em discussão**; não volte a colar o dia inteiro.

## FLUXO NOVO AGENDAMENTO`;

function patchSm(sm) {
  if (typeof sm !== "string") return sm;
  if (sm.includes("## VAGAS — MENSAGENS CURTAS")) return sm;
  if (!sm.includes(NEEDLE)) return sm;
  return sm.replace(NEEDLE, INSERT);
}

function walk(nodes) {
  let n = 0;
  if (!Array.isArray(nodes)) return 0;
  for (const node of nodes) {
    if (
      node?.name === "agente_agendador" &&
      node?.type === "@n8n/n8n-nodes-langchain.agent"
    ) {
      const sm = node?.parameters?.options?.systemMessage;
      const next = patchSm(sm);
      if (next !== sm) {
        node.parameters = node.parameters || {};
        node.parameters.options = node.parameters.options || {};
        node.parameters.options.systemMessage = next;
        n++;
      }
    }
  }
  return n;
}

const workflow = JSON.parse(readFileSync(wfPath, "utf8"));
let total = walk(workflow.nodes);
if (workflow.activeVersion?.nodes) total += walk(workflow.activeVersion.nodes);

writeFileSync(wfPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log(`agente_agendador: ${total} node(s) → ${wfPath}`);
