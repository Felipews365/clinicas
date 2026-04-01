/**
 * PATCH workflow kCX2LfxJrdYWB0vk — alinhamento painel (clinics + cs_clientes + tools tenant).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mcp = JSON.parse(fs.readFileSync(path.join(root, ".cursor", "mcp.json"), "utf8"));
const apiBase = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const WF_ID = "kCX2LfxJrdYWB0vk";

const TELEFONE_CLIENTE =
  "={{ String($('Campos iniciais').item.json.numCliente || '').split('@')[0].replace(/\\D/g, '') }}";
const CLINICA_ID = "={{ $('Code merge webhook e resolucao').first().json.clinica_id }}";
const SESSION_KEY =
  "={{ $('Code merge webhook e resolucao').first().json.clinica_id + ':' + $('Webhook').first().json.body.data.key.remoteJid }}";

const TOOL_HTTP_NAMES = [
  "cs_buscar_agendamentos",
  "cs_consultar_vagas",
  "cs_consultar_servicos",
  "cs_agendar",
  "cs_reagendar",
  "cs_cancelar",
  "cs_consultar_profissionais",
];

const RPC_PATH = {
  cs_buscar_agendamentos: "/rest/v1/rpc/n8n_cs_buscar_agendamentos",
  cs_consultar_vagas: "/rest/v1/rpc/n8n_cs_consultar_vagas",
  cs_consultar_servicos: "/rest/v1/rpc/n8n_clinic_procedimentos",
  cs_agendar: "/rest/v1/rpc/n8n_cs_agendar",
  cs_reagendar: "/rest/v1/rpc/n8n_cs_reagendar",
  cs_cancelar: "/rest/v1/rpc/n8n_cs_cancelar",
};

const CODE_NORMALIZAR = `const item = { ...$input.first().json };
const body = item.body ?? {};
const rawEvent = body.event ?? item.event ?? '';
let event = String(rawEvent).trim();
if (event.includes('.')) {
  event = event.replace(/\\./g, '_').toUpperCase();
} else if (event) {
  event = event.toUpperCase();
}
function getInstance(b) {
  return String(
    b.instance ||
    b.instanceName ||
    b.data?.instance ||
    b.data?.instanceName ||
    ''
  ).trim();
}
function digits(s) {
  return String(s ?? '').replace(/\\D/g, '');
}
const instance_name = getInstance(body);
const data = body.data ?? {};
const senderRaw = String(body.sender ?? data.sender ?? '').trim();
let numero_clinica = String(
  body.numero_clinica ??
    data.numero_clinica ??
    item.headers?.['x-numero-clinica'] ??
    ''
).trim();
if (!numero_clinica && senderRaw) {
  const d = digits(senderRaw);
  if (d) numero_clinica = d;
}
if (!event && body.data?.key?.remoteJid) {
  event = 'MESSAGES_UPSERT';
}
const ev = String(body.event ?? rawEvent ?? '').toLowerCase();
if (!event && (ev.includes('connection') || data?.state !== undefined)) {
  event = 'CONNECTION_UPDATE';
}
const whSrc = item._wh_source === 'test' ? 'test' : 'prod';
const _tenant = { event, instance_name, numero_clinica, wh_source: whSrc };
return [{ json: { ...item, _tenant } }];`;

function pick(nodes, pred) {
  const n = nodes.find(pred);
  return n || null;
}

async function main() {
  const res = await fetch(`${apiBase}/workflows/${WF_ID}`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  if (!res.ok) throw new Error(`GET workflow ${res.status} ${await res.text()}`);
  const wf = await res.json();
  const { nodes } = wf;

  const credRef =
    pick(nodes, (n) => n.name === "Get Empresa")?.credentials?.supabaseApi ??
    pick(nodes, (n) => n.type === "n8n-nodes-base.supabase")?.credentials?.supabaseApi;
  if (!credRef?.id) throw new Error("Could not resolve supabaseApi credential from workflow");

  const rpcResolve = pick(nodes, (n) => n.name === "HTTP RPC n8n_resolve_clinic");
  if (rpcResolve?.parameters) {
    rpcResolve.parameters.url =
      "={{ ($env.SUPABASE_URL || 'https://xkwdwioawosthwjqijfb.supabase.co').replace(/\\/+$/, '') + '/rest/v1/rpc/n8n_resolve_clinic' }}";
  }

  const norm = pick(
    nodes,
    (n) => n.name.includes("Code Normalizar") && n.name.includes("Evolution"),
  );
  if (norm) norm.parameters = { ...norm.parameters, jsCode: CODE_NORMALIZAR };

  const sw = pick(nodes, (n) => n.name === "Switch assinatura e acesso");
  if (sw?.parameters?.rules?.values) {
    for (const rule of sw.parameters.rules.values) {
      const c = rule.conditions?.conditions?.[0];
      if (c?.rightValue === "mensal_expirado" && rule.renameOutput) {
        rule.outputKey = "plano_expirado_ou_inadimplente";
      }
    }
  }

  const ge = pick(nodes, (n) => n.name === "Get Empresa");
  if (ge) {
    ge.parameters = {
      operation: "get",
      tableId: "clinics",
      filters: { conditions: [{ keyName: "id", keyValue: CLINICA_ID }] },
    };
  }

  const gc = pick(nodes, (n) => n.name === "Get Cliente");
  if (gc) {
    gc.parameters = {
      operation: "get",
      tableId: "cs_clientes",
      filters: {
        conditions: [
          { keyName: "clinic_id", keyValue: "={{ $('Get Empresa').item.json.id }}" },
          { keyName: "telefone", keyValue: TELEFONE_CLIENTE },
        ],
      },
    };
  }

  const cc = pick(nodes, (n) => n.name === "Create Cliente");
  if (cc) {
    cc.parameters = {
      tableId: "cs_clientes",
      fieldsUi: {
        fieldValues: [
          { fieldId: "nome", fieldValue: "={{ $('Campos iniciais').item.json.nomeCliente }}" },
          { fieldId: "telefone", fieldValue: TELEFONE_CLIENTE },
          { fieldId: "clinic_id", fieldValue: "={{ $('Get Empresa').item.json.id }}" },
          { fieldId: "bot_ativo", fieldValue: "={{ true }}" },
        ],
      },
    };
  }

  const bot = pick(nodes, (n) => n.name === "Bot inativo");
  if (bot) {
    bot.parameters = {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
        conditions: [
          {
            id: "13822dc1-3f22-4105-bd78-151817f0786f",
            leftValue: "={{ $json.bot_ativo }}",
            rightValue: false,
            operator: { type: "boolean", operation: "equals", name: "filter.operator.equals" },
          },
        ],
        combinator: "and",
      },
      options: {},
    };
  }

  const ver = pick(nodes, (n) => n.name.includes("Verificar se cliente"));
  if (ver?.parameters?.conditions?.conditions?.[0]) {
    ver.parameters.conditions.conditions[0].leftValue = "={{ $json.telefone }}";
  }

  for (const nm of ["Get Empresa1", "Get Empresa2"]) {
    const x = pick(nodes, (n) => n.name === nm);
    if (x) {
      x.parameters = {
        operation: "get",
        tableId: "clinics",
        filters: { conditions: [{ keyName: "id", keyValue: CLINICA_ID }] },
      };
    }
  }

  for (const nm of ["Update Cliente", "Update Cliente1"]) {
    const x = pick(nodes, (n) => n.name === nm);
    if (x) {
      const fieldVal = nm === "Update Cliente" ? "={{ false }}" : "={{ true }}";
      x.parameters = {
        operation: "update",
        tableId: "cs_clientes",
        matchType: "allFilters",
        filters: {
          conditions: [
            { keyName: "clinic_id", condition: "eq", keyValue: "={{ $json.id }}" },
            { keyName: "telefone", condition: "eq", keyValue: TELEFONE_CLIENTE },
          ],
        },
        fieldsUi: { fieldValues: [{ fieldId: "bot_ativo", fieldValue: fieldVal }] },
      };
    }
  }

  const buscarCfg = pick(nodes, (n) => n.name.includes("Buscar Config"));
  if (buscarCfg) {
    buscarCfg.credentials = { supabaseApi: { id: credRef.id, name: credRef.name } };
    buscarCfg.parameters = {
      ...buscarCfg.parameters,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
      url:
        "={{ ($env.SUPABASE_URL || 'https://xkwdwioawosthwjqijfb.supabase.co').replace(/\\/+$/, '') + '/rest/v1/clinics' }}",
      sendQuery: true,
      sendHeaders: false,
      headerParameters: { parameters: [] },
      queryParameters: {
        parameters: [
          { name: "select", value: "id,name,phone,timezone,agent_instructions" },
          {
            name: "id",
            value:
              "={{ 'eq.' + $('Code merge webhook e resolucao').first().json.clinica_id }}",
          },
        ],
      },
    };
    delete buscarCfg.parameters.headerAuth;
  }

  const baseUrlExpr =
    "($env.SUPABASE_URL || 'https://xkwdwioawosthwjqijfb.supabase.co').replace(/\\/+$/, '')";
  for (const nm of TOOL_HTTP_NAMES) {
    const t = pick(nodes, (n) => n.name === nm);
    if (!t?.parameters) continue;
    t.credentials = { supabaseApi: { id: credRef.id, name: credRef.name } };
    t.parameters.authentication = "predefinedCredentialType";
    t.parameters.nodeCredentialType = "supabaseApi";
    delete t.parameters.parametersHeaders;
    t.parameters.sendHeaders = false;
    if (nm === "cs_consultar_profissionais") {
      t.parameters.url = `={{ ${baseUrlExpr} + '/rest/v1/professionals?select=id,name,specialty&is_active=eq.true&order=name.asc&clinic_id=eq.' + $('Code merge webhook e resolucao').first().json.clinica_id }}`;
    } else {
      const path = RPC_PATH[nm];
      if (path) t.parameters.url = `={{ ${baseUrlExpr} + '${path}' }}`;
    }
  }

  const mem = pick(nodes, (n) => n.name === "Postgres Chat Memory");
  if (mem?.parameters) mem.parameters.sessionKey = SESSION_KEY;

  const serv = pick(nodes, (n) => n.name === "cs_consultar_servicos");
  if (serv?.parameters) {
    serv.parameters.jsonBody =
      "={{ JSON.stringify({ p_clinic_id: $('Code merge webhook e resolucao').first().json.clinica_id }) }}";
  }

  const vagas = pick(nodes, (n) => n.name === "cs_consultar_vagas");
  if (vagas?.parameters) {
    vagas.parameters.specifyBody = "json";
    vagas.parameters.jsonBody =
      "={{ JSON.stringify({ p_clinic_id: $('Code merge webhook e resolucao').first().json.clinica_id }) }}";
  }

  const busc = pick(nodes, (n) => n.name === "cs_buscar_agendamentos");
  if (busc?.parameters) {
    busc.parameters.jsonBody = `={
  "p_telefone": "{telefone}",
  "p_clinic_id": "={{ $('Code merge webhook e resolucao').first().json.clinica_id }}"
}`;
  }

  const putBody = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: { executionOrder: "v1" },
    ...(wf.staticData != null ? { staticData: wf.staticData } : {}),
  };

  const put = await fetch(`${apiBase}/workflows/${WF_ID}`, {
    method: "PUT",
    headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(putBody),
  });
  if (!put.ok) throw new Error(`PUT workflow ${put.status} ${await put.text()}`);
  console.log("OK:", WF_ID);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
