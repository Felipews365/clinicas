/**
 * Adiciona ao workflow:
 *  - strip do marker [SEND_LOCATION] no node "Edit Fields" e campo `_send_location` boolean
 *  - novo node "If Send Location" (if) ligado em paralelo a Edit Fields
 *  - novo node "Evolution sendLocation" (httpRequest) ligado ao branch TRUE
 *
 * Tenant-safe: o sendLocation usa $('Monta Contexto').first().json.loc_latitude/longitude/...
 *
 * Uso: node n8n/patch-send-location-branch.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");

const IF_NODE_ID = "send-loc-if-v1";
const SEND_NODE_ID = "send-loc-evolution-v1";
const IF_NODE_NAME = "If Send Location";
const SEND_NODE_NAME = "Evolution sendLocation";

const NEW_ANSWER_EXPR =
  "={{ [$json.output.trim().replace(/\\s*\\[ROTA:[^\\]]+\\]\\s*/gi, '').replace(/\\s*\\[SEND_LOCATION\\]\\s*/gi, '').trim()] }}";
const SEND_LOC_FLAG_EXPR =
  "={{ /\\[SEND_LOCATION\\]/i.test($json.output || '') }}";

function patchEditFields(node) {
  const arr = node?.parameters?.assignments?.assignments;
  if (!Array.isArray(arr)) return false;
  let changed = false;
  const answer = arr.find((a) => a.name === "answer");
  if (answer && answer.value !== NEW_ANSWER_EXPR) {
    answer.value = NEW_ANSWER_EXPR;
    changed = true;
  }
  if (!arr.find((a) => a.name === "_send_location")) {
    arr.push({
      id: "f1a3b2c4-5d6e-7f80-9a1b-2c3d4e5f6a7b",
      name: "_send_location",
      value: SEND_LOC_FLAG_EXPR,
      type: "boolean",
    });
    changed = true;
  }
  return changed;
}

function buildIfNode(pos) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
        conditions: [
          {
            id: "send-loc-cond-1",
            leftValue: "={{ $json._send_location }}",
            rightValue: true,
            operator: { type: "boolean", operation: "true", singleValue: true },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    id: IF_NODE_ID,
    name: IF_NODE_NAME,
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: pos,
  };
}

function buildSendNode(pos) {
  return {
    parameters: {
      method: "POST",
      url:
        "={{ 'https://evolutionapi.vps7846.panel.icontainer.cloud/message/sendLocation/' + ($('Monta Contexto').first().json.instanceName || $('Edit Fields1').first().json.instanceName || '') }}",
      authentication: "none",
      sendHeaders: true,
      specifyHeaders: "keypair",
      headerParameters: {
        parameters: [
          { name: "Content-Type", value: "application/json" },
          { name: "apikey", value: "6PWyAsF3cip8QZ2JxNSRk4M5A5yEi4G8" },
        ],
      },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody:
        "={{ JSON.stringify({ number: $('Edit Fields1').first().json.numCliente, latitude: $('Monta Contexto').first().json.loc_latitude, longitude: $('Monta Contexto').first().json.loc_longitude, name: $('Monta Contexto').first().json.loc_name, address: $('Monta Contexto').first().json.loc_address }) }}",
      options: {},
    },
    id: SEND_NODE_ID,
    name: SEND_NODE_NAME,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: pos,
    onError: "continueErrorOutput",
  };
}

function patchWorkflow(workflow) {
  const nodes = workflow.nodes;
  const conns = workflow.connections;
  const ef = nodes.find((n) => n.name === "Edit Fields" && n.type === "n8n-nodes-base.set");
  if (!ef) {
    console.warn("Edit Fields não encontrado");
    return false;
  }
  const efChanged = patchEditFields(ef);

  const hasIf = nodes.find((n) => n.id === IF_NODE_ID);
  const hasSend = nodes.find((n) => n.id === SEND_NODE_ID);

  const [efX, efY] = ef.position || [0, 0];
  if (!hasIf) nodes.push(buildIfNode([efX + 240, efY + 180]));
  if (!hasSend) nodes.push(buildSendNode([efX + 480, efY + 180]));

  // Connection: Edit Fields → If Send Location (paralelo ao Quebra)
  const fromEf = conns["Edit Fields"]?.main?.[0] || [];
  if (!fromEf.find((c) => c.node === IF_NODE_NAME)) {
    fromEf.push({ node: IF_NODE_NAME, type: "main", index: 0 });
    conns["Edit Fields"] = { main: [fromEf] };
  }
  // Connection: If [TRUE] → Evolution sendLocation
  if (!conns[IF_NODE_NAME]) {
    conns[IF_NODE_NAME] = { main: [[{ node: SEND_NODE_NAME, type: "main", index: 0 }], []] };
  }

  return efChanged || !hasIf || !hasSend;
}

const workflow = JSON.parse(readFileSync(wfPath, "utf8"));
let any = patchWorkflow(workflow);
if (workflow.activeVersion) {
  any = patchWorkflow(workflow.activeVersion) || any;
}
writeFileSync(wfPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log(any ? "send-location: workflow atualizado" : "send-location: nada a mudar");
