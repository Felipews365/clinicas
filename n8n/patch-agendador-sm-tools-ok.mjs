/**
 * Alinha o systemMessage do agente_agendador com os nomes reais das tools (agd_cs_*)
 * e reforça: nunca confirmar ao cliente sem JSON da tool de escrita com ok===true.
 *
 * Uso: node n8n/patch-agendador-sm-tools-ok.mjs
 * Atualiza n8n/workflow-kCX2-live.json (nodes + activeVersion.nodes).
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");

const INSERT_AFTER =
  "Nunca anuncie que vai fazer — faça.\n\n## FORMATAÇÃO";
const INSERT_BLOCK = `Nunca anuncie que vai fazer — faça.

## NOMES EXATOS DAS TOOLS (este agente)
As ferramentas conectadas a você no n8n começam com **agd_cs_**. Exemplos: **agd_cs_consultar_vagas**, **agd_cs_agendar**, **agd_cs_buscar_agendamentos**, **agd_cs_reagendar**, **agd_cs_cancelar**. Não existe tool registrada só como \`cs_agendar\` ou \`cs_consultar_vagas\` — use sempre o prefixo **agd_cs_**.

**Confirmação ao cliente:** é **absolutamente proibido** dizer que o horário foi confirmado, agendado ou registrado se você **não** acabou de receber o JSON da **agd_cs_agendar** (ou **agd_cs_reagendar** / **agd_cs_cancelar**, conforme o caso) com campo **ok** igual a **true**. Sem essa chamada e sem ok true, não simule sucesso — diga que ainda vai registrar, peça dado que falta, ou repasse message/error com honestidade.

**Depois de \`ok: true\` em agd_cs_agendar:** o resumo ao cliente deve usar a **mesma** data e horário que você enviou nos parâmetros da tool (converta data para dd/MM/yyyy se falar com o cliente). Não invente outro dia nem outro horário.

## FORMATAÇÃO`;

/** Só substitui cs_* que ainda não têm prefixo agd_ (evita agd_agd_cs_*). */
const REPLACEMENTS = [
  ["cs_consultar_profissionais", "agd_cs_consultar_profissionais"],
  ["cs_consultar_servicos", "agd_cs_consultar_servicos"],
  ["cs_consultar_vagas", "agd_cs_consultar_vagas"],
  ["cs_buscar_agendamentos", "agd_cs_buscar_agendamentos"],
  ["cs_reagendar", "agd_cs_reagendar"],
  ["cs_cancelar", "agd_cs_cancelar"],
  ["cs_notificar_profissional", "agd_cs_notificar_profissional"],
  ["cs_agendar", "agd_cs_agendar"],
];

function applyToolPrefixReplacements(s) {
  let out = s;
  for (const [from, to] of REPLACEMENTS) {
    const re = new RegExp(`(?<!agd_)${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
    out = out.replace(re, to);
  }
  return out;
}

function patchSystemMessage(raw) {
  if (typeof raw !== "string") return raw;

  let s = raw;
  while (s.includes("agd_agd_cs_")) {
    s = s.split("agd_agd_cs_").join("agd_cs_");
  }

  if (s.includes("## NOMES EXATOS DAS TOOLS (este agente)")) {
    return applyToolPrefixReplacements(s);
  }

  if (!s.includes("CHAME cs_consultar_vagas AGORA")) return s;

  if (s.includes(INSERT_AFTER)) {
    s = s.replace(INSERT_AFTER, INSERT_BLOCK);
  }
  s = applyToolPrefixReplacements(s);
  return s;
}

function walkNodes(nodes) {
  if (!Array.isArray(nodes)) return 0;
  let n = 0;
  for (const node of nodes) {
    if (
      node?.name === "agente_agendador" &&
      node?.type === "@n8n/n8n-nodes-langchain.agent"
    ) {
      const sm = node?.parameters?.options?.systemMessage;
      const next = patchSystemMessage(sm);
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
let total = walkNodes(workflow.nodes);
if (workflow.activeVersion?.nodes) {
  total += walkNodes(workflow.activeVersion.nodes);
}

writeFileSync(wfPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log(`Atualizado systemMessage em ${total} node(s) agente_agendador → ${wfPath}`);
