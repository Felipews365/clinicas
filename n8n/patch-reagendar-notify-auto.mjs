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

const ctx = $('Monta Contexto').first().json;
const inst = String($('Edit Fields1').first().json.instanceName || '').trim();
const nome = String(ctx.nome_cliente || 'Cliente').trim();
const tail = String(item.output || '').trim().slice(-400);
const out = String(item.output || '');

const looksLikeMutation =
  /(reagendad|agendad\\s+com\\s+sucesso|agendamento[^\\n]{0,120}sucesso|cancelad|cancelamento)/i.test(
    out,
  );

let notify = null;

if (looksLikeMutation && ctx.clinic_id) {
  const remoteJid = String(ctx.remoteJid || '');
  const SUPABASE_URL = 'https://xkwdwioawosthwjqijfb.supabase.co';
  const SUPABASE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhrd2R3aW9hd29zdGh3anFpamZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUyNzUzMywiZXhwIjoyMDkwMTAzNTMzfQ._CoWPqn1bDqNRJ-g6EzGnqE86YI_LW5T_N6At3CPal4';

  let rpc = null;
  try {
    rpc = await $helpers.httpRequest({
      method: 'POST',
      url: SUPABASE_URL.replace(/\\/+$/, '') + '/rest/v1/rpc/n8n_cs_profissional_whatsapp_mudanca_recente',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_clinic_id: ctx.clinic_id, p_telefone: remoteJid }),
    });
  } catch {
    rpc = null;
  }

  if (rpc && rpc.ok === true && rpc.profissional_whatsapp) {
    const num = String(rpc.profissional_whatsapp).replace(/\\D/g, '');
    if (num.length >= 12) {
      const prefix = /reagendad/i.test(out)
        ? '🔄 Reagendamento (IA): '
        : /cancel/i.test(out)
          ? '❌ Cancelamento (IA): '
          : '📅 Novo agendamento (IA): ';
      notify = {
        number: num,
        instanceName: inst,
        text: prefix + nome + (tail ? '\\n' + tail : '\\nVerifique o painel da clínica.'),
      };
    }
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
