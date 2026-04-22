/**
 * Corrige dois problemas de configuração nos nós agd_* do agente_agendador:
 *
 * 1. agd_cs_notificar_profissional:
 *    URL usa `=https://...{{ }}` (sintaxe inválida em modo expressão n8n).
 *    Corrige para `={{ '...' + expr }}` e aponta instanceName para Edit Fields1
 *    (Campos iniciais não tem o campo instanceName).
 *
 * 2. agd_cs_consultar_profissionais:
 *    Falta `method` explícito (toolHttpRequest v1.1 exige).
 *    Adiciona `method: "GET"`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

let changed = 0;

// ---- Fix 1: agd_cs_notificar_profissional URL ----
const notif = data.nodes.find((n) => n.name === "agd_cs_notificar_profissional");
if (!notif) {
  console.error("Node 'agd_cs_notificar_profissional' not found!");
  process.exit(1);
}

const BAD_URL = "=https://evo.plataformabot.top/message/sendText/{{ $('Campos iniciais').first().json.instanceName }}";
const GOOD_URL = "={{ 'https://evo.plataformabot.top/message/sendText/' + $('Edit Fields1').first().json.instanceName }}";

if (notif.parameters.url === BAD_URL) {
  notif.parameters.url = GOOD_URL;
  console.log("✓ agd_cs_notificar_profissional: URL fixed.");
  changed++;
} else if (notif.parameters.url === GOOD_URL) {
  console.log("✓ agd_cs_notificar_profissional: URL already correct.");
} else {
  console.warn("⚠ agd_cs_notificar_profissional: unexpected URL value:", notif.parameters.url);
  console.log("Applying fix anyway...");
  notif.parameters.url = GOOD_URL;
  changed++;
}

// ---- Fix 2: agd_cs_consultar_profissionais method ----
const prof = data.nodes.find((n) => n.name === "agd_cs_consultar_profissionais");
if (!prof) {
  console.error("Node 'agd_cs_consultar_profissionais' not found!");
  process.exit(1);
}

if (!prof.parameters.method) {
  prof.parameters.method = "GET";
  console.log("✓ agd_cs_consultar_profissionais: method: 'GET' added.");
  changed++;
} else {
  console.log("✓ agd_cs_consultar_profissionais: method already set to", prof.parameters.method);
}

if (changed === 0) {
  console.log("No changes needed. Exiting.");
  process.exit(0);
}

// ---- Save ----
fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log("✓ workflow-kCX2-live.json saved.");

// ---- Push to n8n ----
const mcpPath = path.join(__dirname, "..", ".cursor", "mcp.json");
const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const workflowId = data.id;

console.log(`\nPushing workflow ${workflowId} to n8n...`);

const getRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
if (!getRes.ok) {
  console.error("GET failed", getRes.status, await getRes.text());
  process.exit(1);
}
const current = await getRes.json();

const body = {
  name: data.name ?? current.name,
  nodes: data.nodes,
  connections: data.connections,
  settings: { executionOrder: current.settings?.executionOrder ?? "v1" },
  staticData: current.staticData ?? undefined,
};

const putRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await putRes.text();
if (!putRes.ok) {
  console.error("PUT failed", putRes.status, text);
  process.exit(1);
}
console.log("✓ Workflow pushed to n8n:", putRes.status, text.slice(0, 200));
