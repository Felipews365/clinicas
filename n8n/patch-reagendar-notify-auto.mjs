/**
 * 1) agente_agendador: reforça reagendar vs agendar + fidelidade a cs_consultar_vagas;
 *    remove instrução de chamar cs_notificar_profissional.
 * 2) Desconecta agd_cs_notificar_profissional do agente.
 * 3) Insere Code + IF + HTTP após agente_agendador para notificar profissional sem LLM.
 * 4) Atualiza connections: agente_agendador → Code → Edit Fields; Code → IF → HTTP.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const workflow = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const OLD_BLOCK =
  "## FLUXO CANCELAR / REAGENDAR\n1. CHAME cs_buscar_agendamentos → mostre lista\n2. Confirme explicitamente ANTES de CHAMAR cs_cancelar ou cs_reagendar\n\n## PÓS AGENDAMENTO/CANCELAMENTO/REAGENDAMENTO\nSe profissional_whatsapp ≠ null → CHAME cs_notificar_profissional ANTES de responder ao cliente\n- Agendamento: \"📅 Novo agendamento: {nome}, {serviço}, {data} às {horário}\"\n- Reagendamento: \"🔄 Reagendamento: {nome}, {serviço}, {nova_data} às {novo_horário}\"\n- Cancelamento: \"❌ Cancelamento: {nome}, {serviço}, {data} às {horário}\"";

const NEW_BLOCK =
  "## FLUXO CANCELAR / REAGENDAR\n1. CHAME cs_buscar_agendamentos e guarde de cada item: id (agendamento_id), profissional_id, data_iso, horario, nome_procedimento.\n2. Se o cliente quer mudar data e/ou horário e já existe agendamento ativo na lista → use SEMPRE **cs_reagendar** com agendamento_id + profissional_antigo_id + data_antiga + horario_antigo + novo_profissional_id (muito frequentemente o mesmo UUID) + nova_data + novo_horario. **NUNCA use cs_agendar** nesse caso — cs_agendar cria um SEGUNDO agendamento (duplicado).\n3. Use **cs_agendar** apenas quando o cliente **não** tem consulta ativa para aquele atendimento (primeiro agendamento ou já cancelou todos).\n4. Confirme explicitamente ANTES de CHAMAR cs_cancelar ou cs_reagendar.\n\n## cs_consultar_vagas — SOMENTE O JSON RETORNADO\nApós cs_consultar_vagas, os únicos horários válidos são os valores \"horario\" (HH:MM) dos objetos do array retornado.\n- Liste **todos** os horários retornados, sem pular nenhum. Se o JSON contém \"10:00\", você **deve** incluir 10:00 na lista ao cliente.\n- **Proibido** inventar horário que não apareça no JSON.\n- Antes de dizer que não há vaga às HH:MM, procure no array um item com horario **exatamente** igual a HH:MM. Se existir → o horário está disponível; confirme com o cliente.\n\n## NOTIFICAÇÃO AO PROFISSIONAL\n**Não chame cs_notificar_profissional.** Depois de cs_agendar, cs_reagendar ou cs_cancelar com sucesso, responda ao cliente normalmente — o fluxo envia WhatsApp ao profissional automaticamente quando houver profissional_whatsapp na resposta da RPC.";

const STEP8_OLD = "8. CHAME cs_agendar com todos os dados";
const STEP8_NEW =
  "8. CHAME **cs_reagendar** (se já havia agendamento ativo listado em cs_buscar_agendamentos) OU **cs_agendar** (se é primeiro agendamento) com todos os dados corretos";

const ag = workflow.nodes.find((n) => n.name === "agente_agendador");
if (!ag?.parameters?.options?.systemMessage) throw new Error("agente_agendador not found");
let sm = ag.parameters.options.systemMessage;
if (!sm.includes(OLD_BLOCK)) {
  console.warn("OLD_BLOCK not found verbatim — check systemMessage");
} else {
  sm = sm.replace(OLD_BLOCK, NEW_BLOCK);
}
if (sm.includes(STEP8_OLD)) sm = sm.replace(STEP8_OLD, STEP8_NEW);
ag.parameters.options.systemMessage = sm;

// Disconnect notify tool from agent
if (!workflow.connections["agd_cs_notificar_profissional"]) {
  console.warn("agd_cs_notificar_profissional connections missing");
} else {
  workflow.connections["agd_cs_notificar_profissional"].ai_tool = [[]];
}

const CODE_ID = "a1b2notify-0001-4000-8000-000000000001";
const IF_ID = "a1b2notify-0002-4000-8000-000000000002";
const HTTP_ID = "a1b2notify-0003-4000-8000-000000000003";

const codeJs = `const item = { ...$input.first().json };

function parseLast(nodeName) {
  try {
    const rows = $(nodeName).all();
    if (!rows?.length) return null;
    const raw = rows[rows.length - 1].json?.response;
    if (raw == null) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return null;
  }
}

const ctx = $('Monta Contexto').first().json;
const inst = String($('Edit Fields1').first().json.instanceName || '').trim();
const nome = String(ctx.nome_cliente || 'Cliente').trim();
let notify = null;

const ag = parseLast('agd_cs_agendar');
const re = parseLast('agd_cs_reagendar');
const ca = parseLast('agd_cs_cancelar');
const tail = String(item.output || '').trim().slice(-400);

if (ag?.ok && ag.profissional_whatsapp) {
  const num = String(ag.profissional_whatsapp).replace(/\\D/g, '');
  if (num.length >= 10) {
    notify = { number: num, instanceName: inst, text: '📅 Novo agendamento (IA): ' + nome + (tail ? ('\\n' + tail) : '\\nVerifique o painel da clínica.') };
  }
} else if (re?.ok && re.profissional_whatsapp) {
  const num = String(re.profissional_whatsapp).replace(/\\D/g, '');
  if (num.length >= 10) {
    notify = { number: num, instanceName: inst, text: '🔄 Reagendamento (IA): ' + nome + (tail ? ('\\n' + tail) : '\\nVerifique o painel da clínica.') };
  }
} else if (ca?.ok && ca.profissional_whatsapp) {
  const num = String(ca.profissional_whatsapp).replace(/\\D/g, '');
  if (num.length >= 10) {
    notify = { number: num, instanceName: inst, text: '❌ Cancelamento (IA): ' + nome + (tail ? ('\\n' + tail) : '\\nVerifique o painel da clínica.') };
  }
}

return [{ json: { ...item, _evolution_notify: notify } }];`;

// Remove existing nodes if re-running patch
workflow.nodes = workflow.nodes.filter((n) => ![CODE_ID, IF_ID, HTTP_ID].includes(n.id));

workflow.nodes.push({
  id: CODE_ID,
  name: "Code auto-notify profissional",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [3550, 40],
  parameters: { mode: "runOnceForAllItems", jsCode: codeJs },
});

workflow.nodes.push({
  id: IF_ID,
  name: "IF notify profissional",
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: [3780, 160],
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
      conditions: [
        {
          id: "if-notify-1",
          leftValue: "={{ $json._evolution_notify?.number }}",
          rightValue: "",
          operator: { type: "string", operation: "notEmpty" },
        },
      ],
      combinator: "and",
    },
    options: {},
  },
});

workflow.nodes.push({
  id: HTTP_ID,
  name: "HTTP Evolution notify profissional",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [4000, 280],
  parameters: {
    method: "POST",
    url: "={{ 'https://evo.plataformabot.top/message/sendText/' + ($json._evolution_notify.instanceName || $('Edit Fields1').first().json.instanceName || '') }}",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "Content-Type", value: "application/json" },
        { name: "apikey", value: "E24A6298-300E-4794-89C8-23783D858B12" },
      ],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody:
      "={{ JSON.stringify({ number: $json._evolution_notify.number, text: $json._evolution_notify.text, delay: 1000 }) }}",
    options: {},
  },
});

// agente_agendador → Code (was → Edit Fields)
workflow.connections["agente_agendador"] = {
  main: [[{ node: "Code auto-notify profissional", type: "main", index: 0 }]],
};

workflow.connections["Code auto-notify profissional"] = {
  main: [
    [
      { node: "Edit Fields", type: "main", index: 0 },
      { node: "IF notify profissional", type: "main", index: 0 },
    ],
  ],
};

workflow.connections["IF notify profissional"] = {
  main: [
    [{ node: "HTTP Evolution notify profissional", type: "main", index: 0 }],
    [],
  ],
};

fs.writeFileSync(wfPath, JSON.stringify(workflow, null, 2));
console.log("OK: workflow-kCX2-live.json updated");
