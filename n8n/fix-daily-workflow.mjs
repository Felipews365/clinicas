import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpPath = path.join(__dirname, "..", ".cursor", "mcp.json");
const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const id = "OG6mNupmXUjersFr";
const supaFallback = "https://xkwdwioawosthwjqijfb.supabase.co";

const getRes = await fetch(`${baseUrl}/workflows/${id}`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const w = await getRes.json();

for (const nid of ["crm-daily-list", "crm-daily-run"]) {
  const n = w.nodes.find((x) => x.id === nid);
  if (n?.parameters?.url) {
    n.parameters.url = `={{ ($env.SUPABASE_URL || '${supaFallback}').replace(/\\/+$/, '') + '/rest/v1/rpc/${
      nid === "crm-daily-list"
        ? "n8n_crm_list_daily_eligible_clinics"
        : "n8n_crm_daily_clinic_run"
    }' }}`;
  }
}

const send = w.nodes.find((n) => n.id === "crm-daily-send");
if (send) {
  send.parameters.jsonBody =
    "={{ JSON.stringify({ number: String($json.telefone || '').replace(/\\D/g, ''), text: String($json.mensagem || '') }) }}";
}
const flat = w.nodes.find((n) => n.id === "crm-daily-flat");
if (flat) {
  flat.parameters.jsCode = `const raw = $input.first().json;
let row = raw.body ?? raw;
if (Array.isArray(row)) row = row[0] ?? {};
if (row._skip) return [];
const candidates = row.whatsapp_candidates;
let arr = [];
if (Array.isArray(candidates)) arr = candidates;
else if (candidates && typeof candidates === 'object') arr = Object.values(candidates);
if (arr.length === 0) return [{ json: { _skip: true } }];
return arr.map((item) => ({ json: { ...item, _parent_clinic_id: row.clinic_id } }));`;
}
const norm = w.nodes.find((n) => n.id === "crm-daily-norm");
if (norm) {
  norm.parameters.jsCode = `const raw = $input.first().json;
let arr = raw.body ?? raw;
if (typeof arr === 'string') {
  try { arr = JSON.parse(arr); } catch { arr = []; }
}
if (raw && typeof raw === 'object' && !Array.isArray(arr)) {
  arr = arr.data ?? arr.body ?? arr;
}
if (typeof arr === 'string') {
  try { arr = JSON.parse(arr); } catch { arr = []; }
}
if (!Array.isArray(arr)) arr = [];
if (arr.length === 0) return [{ json: { _skip: true, reason: 'no_clinics' } }];
return arr.filter((c) => c && c.id).map((c) => ({ json: c }));`;
}

const body = {
  name: w.name,
  nodes: w.nodes,
  connections: w.connections,
  settings: { executionOrder: w.settings?.executionOrder ?? "v1" },
  staticData: w.staticData,
};

const putRes = await fetch(`${baseUrl}/workflows/${id}`, {
  method: "PUT",
  headers: {
    "X-N8N-API-KEY": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});
const text = await putRes.text();
if (!putRes.ok) {
  console.error(putRes.status, text);
  process.exit(1);
}
console.log("Daily workflow updated OK");
