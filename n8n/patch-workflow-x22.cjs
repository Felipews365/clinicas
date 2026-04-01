"use strict";
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "workflow-x22UDZ4n5BuR7bUk-fetched.json");
const OUT = path.join(__dirname, "workflow-x22UDZ4n5BuR7bUk-refactored.json");

const NORM_CODE = `const item = { ...$input.first().json };
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
const instance_name = getInstance(body);
const data = body.data ?? {};
const numero_clinica = String(
  body.numero_clinica ??
    data.numero_clinica ??
    item.headers?.['x-numero-clinica'] ??
    ''
).trim();
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

const MERGE_CODE = `const base = $('Code Normalizar Evolution Clinica').first().json;
const raw = $input.first().json;
const row = Array.isArray(raw) ? (raw[0] ?? {}) : raw;
const cenario =
  row.cenario ||
  (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.message ? 'clinica_nao_encontrada' : null) ||
  'clinica_nao_encontrada';
return [{ json: { ...base, ...row, cenario } }];`;

function swRule(id, value, key) {
  return {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: "",
        typeValidation: "loose",
        version: 2,
      },
      conditions: [
        {
          id,
          leftValue: "={{ $json.cenario }}",
          rightValue: value,
          operator: { type: "string", operation: "equals" },
        },
      ],
      combinator: "and",
    },
    renameOutput: true,
    outputKey: key,
  };
}

function ifWhSourceMerge(name, nodeId, posX, posY) {
  return {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 2,
        },
        conditions: [
          {
            id: `${nodeId}-c`,
            leftValue:
              "={{ $('Code merge webhook e resolucao').first().json._tenant.wh_source }}",
            rightValue: "test",
            operator: {
              type: "string",
              operation: "equals",
              name: "filter.operator.equals",
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [posX, posY],
    id: nodeId,
    name,
  };
}

const nodesExtra = [
  {
    parameters: {
      httpMethod: "POST",
      path: "a9a0aa31-2d90-45ad-8da2-536c499768d8-test",
      responseMode: "responseNode",
      options: {},
    },
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [-3120, 1380],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567001",
    name: "Webhook Teste",
    webhookId: "b9b0bb41-3e91-45be-9eb2-636c599869d9",
  },
  {
    parameters: {
      assignments: {
        assignments: [
          {
            id: "m-prod-1",
            name: "_wh_source",
            value: "prod",
            type: "string",
          },
        ],
      },
      options: {},
    },
    type: "n8n-nodes-base.set",
    typeVersion: 3.4,
    position: [-3040, 1232],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567002",
    name: "Marcar origem webhook prod",
  },
  {
    parameters: {
      assignments: {
        assignments: [
          {
            id: "m-test-1",
            name: "_wh_source",
            value: "test",
            type: "string",
          },
        ],
      },
      options: {},
    },
    type: "n8n-nodes-base.set",
    typeVersion: 3.4,
    position: [-3040, 1380],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567003",
    name: "Marcar origem webhook teste",
  },
  {
    parameters: { jsCode: NORM_CODE },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [-2928, 1308],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567004",
    name: "Code Normalizar Evolution Clinica",
  },
  {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 2,
        },
        conditions: [
          {
            id: "if-msg-1",
            leftValue: "={{ $json._tenant.event }}",
            rightValue: "MESSAGES_UPSERT",
            operator: {
              type: "string",
              operation: "equals",
              name: "filter.operator.equals",
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [-2800, 1308],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567005",
    name: "IF evento e mensagem",
  },
  {
    parameters: {
      method: "POST",
      url: "={{ ($env.SUPABASE_URL || 'https://xkwdwioawosthwjqijfb.supabase.co').replace(/\\/+$/, '') }}/rest/v1/rpc/n8n_resolve_clinic",
      authentication: "none",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Content-Type", value: "application/json" },
          { name: "apikey", value: "={{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
          {
            name: "Authorization",
            value: "=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}",
          },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ p_instance_name: $json._tenant.instance_name || '', p_numero_clinica: $json._tenant.numero_clinica || '' }) }}",
      options: { timeout: 15000 },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [-2656, 1232],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567006",
    name: "HTTP RPC n8n_resolve_clinic",
    continueOnFail: true,
  },
  {
    parameters: { jsCode: MERGE_CODE },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [-2512, 1232],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567007",
    name: "Code merge webhook e resolucao",
  },
  {
    parameters: {
      rules: {
        values: [
          swRule("sw-1", "clinica_nao_encontrada", "clinica_nao_encontrada"),
          swRule("sw-2", "teste_expirado", "teste_expirado"),
          swRule("sw-3", "mensal_expirado", "mensal_expirado"),
          swRule("sw-4", "ativo", "ativo"),
        ],
      },
      options: {},
    },
    type: "n8n-nodes-base.switch",
    typeVersion: 3,
    position: [-2368, 1232],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567008",
    name: "Switch assinatura e acesso",
  },
  {
    parameters: {
      method: "POST",
      url: "={{ 'https://evo.plataformabot.top/message/sendText/' + ($json._tenant.instance_name || $env.EVOLUTION_INSTANCE || '') }}",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "evolutionApi",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ number: String(($json.body.data.key.remoteJid || '').split('@')[0]).replace(/\\D/g, ''), text: 'Seu periodo de teste deste consultorio expirou. Entre em contacto com o suporte para continuar.' }) }}",
      options: { timeout: 15000 },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [-2128, 1160],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567009",
    name: "HTTP aviso teste expirado",
    credentials: {
      evolutionApi: { id: "Imygiuu6SHaoHNMn", name: "Evolution account felipe" },
    },
    continueOnFail: true,
  },
  {
    parameters: {
      method: "POST",
      url: "={{ 'https://evo.plataformabot.top/message/sendText/' + ($json._tenant.instance_name || $env.EVOLUTION_INSTANCE || '') }}",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "evolutionApi",
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ number: String(($json.body.data.key.remoteJid || '').split('@')[0]).replace(/\\D/g, ''), text: 'A assinatura deste consultorio esta inativa ou em atraso. Regularize o pagamento para voltar a usar o atendimento automatico.' }) }}",
      options: { timeout: 15000 },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [-2128, 1304],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567010",
    name: "HTTP aviso mensal bloqueado",
    credentials: {
      evolutionApi: { id: "Imygiuu6SHaoHNMn", name: "Evolution account felipe" },
    },
    continueOnFail: true,
  },
  ifWhSourceMerge("IF webhook de teste bloqueio", "a1b2c3d4-5e6f-7890-abcd-ef1234567011", -1904, 1088),
  ifWhSourceMerge("IF webhook de teste bloqueio te", "a1b2c3d4-5e6f-7890-abcd-ef1234567012", -1904, 1240),
  ifWhSourceMerge("IF webhook de teste bloqueio me", "a1b2c3d4-5e6f-7890-abcd-ef1234567013", -1904, 1384),
  {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 2,
        },
        conditions: [
          {
            id: "if-t-4",
            leftValue: "={{ $json._tenant.wh_source }}",
            rightValue: "test",
            operator: {
              type: "string",
              operation: "equals",
              name: "filter.operator.equals",
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [-2128, 1520],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567014",
    name: "IF webhook de teste ativo",
  },
  {
    parameters: {
      respondWith: "json",
      responseBody:
        "={{ JSON.stringify({ ok: false, motivo: $('Code merge webhook e resolucao').first().json.cenario, clinica_id: $('Code merge webhook e resolucao').first().json.clinica_id, detalhe: 'Clinica nao encontrada ou ambigua.' }) }}",
      options: {},
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [-1680, 1040],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567015",
    name: "Respond webhook teste bloqueado",
  },
  {
    parameters: {
      respondWith: "json",
      responseBody:
        "={{ JSON.stringify({ ok: false, motivo: $('Code merge webhook e resolucao').first().json.cenario, clinica_id: $('Code merge webhook e resolucao').first().json.clinica_id }) }}",
      options: {},
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [-1680, 1184],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567016",
    name: "Respond webhook teste bloqueado te",
  },
  {
    parameters: {
      respondWith: "json",
      responseBody:
        "={{ JSON.stringify({ ok: false, motivo: $('Code merge webhook e resolucao').first().json.cenario, clinica_id: $('Code merge webhook e resolucao').first().json.clinica_id }) }}",
      options: {},
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [-1680, 1328],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567017",
    name: "Respond webhook teste bloqueado me",
  },
  {
    parameters: {
      respondWith: "json",
      responseBody:
        "={{ JSON.stringify({ ok: true, motivo: 'ativo', clinica_id: $json.clinica_id, cenario: $json.cenario }) }}",
      options: {},
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [-1904, 1520],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567018",
    name: "Respond webhook teste ativo",
  },
  {
    parameters: {},
    type: "n8n-nodes-base.noOp",
    typeVersion: 1,
    position: [-2656, 1408],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567019",
    name: "NoOp demais eventos Evolution",
  },
  {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 2,
        },
        conditions: [
          {
            id: "if-igr-1",
            leftValue: "={{ $json._tenant.wh_source }}",
            rightValue: "test",
            operator: {
              type: "string",
              operation: "equals",
              name: "filter.operator.equals",
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [-2480, 1408],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567023",
    name: "IF teste apos ignorar evento",
  },
  {
    parameters: {
      respondWith: "json",
      responseBody:
        "={{ JSON.stringify({ ok: true, ignorado: true, evento: $json._tenant.event, motivo: 'evento_nao_mensagem' }) }}",
      options: {},
    },
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.1,
    position: [-2256, 1344],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567024",
    name: "Respond webhook teste ignorado",
  },
  {
    parameters: {},
    type: "n8n-nodes-base.noOp",
    typeVersion: 1,
    position: [-1680, 920],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567020",
    name: "NoOp fim producao bloqueado",
  },
  {
    parameters: {},
    type: "n8n-nodes-base.noOp",
    typeVersion: 1,
    position: [-1680, 1120],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567021",
    name: "NoOp fim producao bloqueado te",
  },
  {
    parameters: {},
    type: "n8n-nodes-base.noOp",
    typeVersion: 1,
    position: [-1680, 1264],
    id: "a1b2c3d4-5e6f-7890-abcd-ef1234567022",
    name: "NoOp fim producao bloqueado me",
  },
];

function patchFilterPassAll(nodes) {
  for (const n of nodes) {
    if (n.name !== "Filter") continue;
    const conds = n.parameters.conditions.conditions;
    conds.length = 0;
    conds.push({
      id: "pass-all-1",
      leftValue: "={{ 1 }}",
      rightValue: 1,
      operator: { type: "number", operation: "equals" },
    });
    return;
  }
  throw new Error("Filter node not found");
}

let raw = fs.readFileSync(SRC, "utf8");
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const data = JSON.parse(raw);
const nodes = data.nodes;
const whIdx = nodes.findIndex((n) => n.name === "Webhook");
if (whIdx < 0) throw new Error("Webhook not found");

for (let i = nodesExtra.length - 1; i >= 0; i--) {
  nodes.splice(whIdx + 1, 0, nodesExtra[i]);
}
patchFilterPassAll(data.nodes);

const conn = data.connections;
conn.Webhook = {
  main: [[{ node: "Marcar origem webhook prod", type: "main", index: 0 }]],
};
conn["Webhook Teste"] = {
  main: [[{ node: "Marcar origem webhook teste", type: "main", index: 0 }]],
};
conn["Marcar origem webhook prod"] = {
  main: [[{ node: "Code Normalizar Evolution Clinica", type: "main", index: 0 }]],
};
conn["Marcar origem webhook teste"] = {
  main: [[{ node: "Code Normalizar Evolution Clinica", type: "main", index: 0 }]],
};
conn["Code Normalizar Evolution Clinica"] = {
  main: [[{ node: "IF evento e mensagem", type: "main", index: 0 }]],
};
conn["IF evento e mensagem"] = {
  main: [
    [{ node: "HTTP RPC n8n_resolve_clinic", type: "main", index: 0 }],
    [{ node: "NoOp demais eventos Evolution", type: "main", index: 0 }],
  ],
};
conn["HTTP RPC n8n_resolve_clinic"] = {
  main: [[{ node: "Code merge webhook e resolucao", type: "main", index: 0 }]],
};
conn["Code merge webhook e resolucao"] = {
  main: [[{ node: "Switch assinatura e acesso", type: "main", index: 0 }]],
};
conn["Switch assinatura e acesso"] = {
  main: [
    [{ node: "IF webhook de teste bloqueio", type: "main", index: 0 }],
    [{ node: "HTTP aviso teste expirado", type: "main", index: 0 }],
    [{ node: "HTTP aviso mensal bloqueado", type: "main", index: 0 }],
    [{ node: "IF webhook de teste ativo", type: "main", index: 0 }],
  ],
};
conn.Filter = {
  main: [[{ node: "Campos iniciais", type: "main", index: 0 }]],
};
conn["HTTP aviso teste expirado"] = {
  main: [[{ node: "IF webhook de teste bloqueio te", type: "main", index: 0 }]],
};
conn["HTTP aviso mensal bloqueado"] = {
  main: [[{ node: "IF webhook de teste bloqueio me", type: "main", index: 0 }]],
};
conn["IF webhook de teste bloqueio"] = {
  main: [
    [{ node: "Respond webhook teste bloqueado", type: "main", index: 0 }],
    [{ node: "NoOp fim producao bloqueado", type: "main", index: 0 }],
  ],
};
conn["IF webhook de teste bloqueio te"] = {
  main: [
    [{ node: "Respond webhook teste bloqueado te", type: "main", index: 0 }],
    [{ node: "NoOp fim producao bloqueado te", type: "main", index: 0 }],
  ],
};
conn["IF webhook de teste bloqueio me"] = {
  main: [
    [{ node: "Respond webhook teste bloqueado me", type: "main", index: 0 }],
    [{ node: "NoOp fim producao bloqueado me", type: "main", index: 0 }],
  ],
};
conn["IF webhook de teste ativo"] = {
  main: [
    [{ node: "Respond webhook teste ativo", type: "main", index: 0 }],
    [{ node: "Filter", type: "main", index: 0 }],
  ],
};
conn["Respond webhook teste ativo"] = {
  main: [[{ node: "Filter", type: "main", index: 0 }]],
};
conn["NoOp demais eventos Evolution"] = {
  main: [[{ node: "IF teste apos ignorar evento", type: "main", index: 0 }]],
};
conn["IF teste apos ignorar evento"] = {
  main: [
    [{ node: "Respond webhook teste ignorado", type: "main", index: 0 }],
    [],
  ],
};

fs.writeFileSync(OUT, JSON.stringify(data, null, 4), "utf8");
console.log("Wrote", OUT, "nodes:", data.nodes.length);
