/**
 * Insere IF + HTTP RPC + Code (reidratar Get Cliente) após Get Cliente no workflow Clinica atualizada.
 */
import fs from "fs";

const path = new URL("./workflow-kCX2LfxJrdYWB0vk-panel-aligned.json", import.meta.url);
const j = JSON.parse(fs.readFileSync(path, "utf8"));

const N_IF = "e41ca8b0-9f2c-4c8d-a1e0-crmwhatsapp0001";
const N_HTTP = "e41ca8b0-9f2c-4c8d-a1e0-crmwhatsapp0002";
const N_CODE = "e41ca8b0-9f2c-4c8d-a1e0-crmwhatsapp0003";

const IF_NAME = "CRM Cliente com id?";
const HTTP_NAME = "RPC n8n_crm_whatsapp_touch";
const CODE_NAME = "CRM reidrata Get Cliente";
const VER = "Verificar se cliente est? cadastrado";

const newNodes = [
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
            id: "crm-if-uuid",
            leftValue: "={{ $json.id }}",
            rightValue: "",
            operator: {
              type: "string",
              operation: "notEmpty",
              singleValue: true,
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [-2960, -896],
    id: N_IF,
    name: IF_NAME,
  },
  {
    parameters: {
      method: "POST",
      url: "={{ ($env.SUPABASE_URL || '').replace(/\\/+$/, '') + '/rest/v1/rpc/n8n_crm_whatsapp_touch' }}",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "apikey", value: "={{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
          {
            name: "Authorization",
            value: "=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}",
          },
          { name: "Content-Type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({
  p_clinic_id: $('Get Empresa').first().json.id,
  p_telefone: $('Campos iniciais').first().json.numCliente,
  p_resumo: String($('Campos iniciais').first().json.msg ?? '')
}) }}`,
      options: {},
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [-2750, -980],
    id: N_HTTP,
    name: HTTP_NAME,
  },
  {
    parameters: {
      jsCode:
        "// Mantém o payload do Get Cliente para o IF seguinte ($json.telefone)\nreturn $('Get Cliente').all();",
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [-2540, -980],
    id: N_CODE,
    name: CODE_NAME,
  },
];

function patchGraph(nodes, connections) {
  const dup = newNodes.map((n) => JSON.parse(JSON.stringify(n)));
  const idx = nodes.findIndex((n) => n.name === "Get Cliente");
  if (idx < 0) throw new Error("Get Cliente not found");
  if (nodes.some((n) => n.id === N_IF)) {
    console.error("Already patched (CRM nodes present)");
    return false;
  }
  nodes.splice(idx + 1, 0, ...dup);

  connections["Get Cliente"] = {
    main: [[{ node: IF_NAME, type: "main", index: 0 }]],
  };
  connections[IF_NAME] = {
    main: [
      [{ node: HTTP_NAME, type: "main", index: 0 }],
      [{ node: VER, type: "main", index: 0 }],
    ],
  };
  connections[HTTP_NAME] = {
    main: [[{ node:  CODE_NAME, type: "main", index: 0 }]],
  };
  connections[CODE_NAME] = {
    main: [[{ node: VER, type: "main", index: 0 }]],
  };
  return true;
}

const ok1 = patchGraph(j.nodes, j.connections);
if (j.activeVersion?.nodes && j.activeVersion?.connections) {
  patchGraph(j.activeVersion.nodes, j.activeVersion.connections);
}

if (ok1 !== false) {
  fs.writeFileSync(path, JSON.stringify(j, null, 2), "utf8");
  console.log("Patched:", path.pathname || path);
}
