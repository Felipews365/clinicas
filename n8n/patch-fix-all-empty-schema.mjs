/**
 * Fix: add dummy 'chamada' placeholder to ALL zero-placeholder toolHttpRequest nodes.
 *
 * Root cause: empty Zod schema z.object({}) causes gpt-4o-mini to return
 * arguments:"" instead of arguments:"{}", which fails JSON.parse → toolInput=undefined
 * → "Required → at " (empty path).
 *
 * This patch adds a single dummy placeholder to every zero-placeholder HTTP tool
 * so the schema becomes z.object({ chamada: z.string() }), forcing OpenAI to always
 * send a valid JSON object. The placeholder is never referenced in any URL/body, so
 * it's silently discarded by n8n.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const DUMMY_PLACEHOLDER = {
  name: "chamada",
  description: "Sempre passe uma string vazia \"\". Parâmetro obrigatório pelo schema mas ignorado na requisição.",
  type: "string",
};

const httpTools = data.nodes.filter(
  (n) => n.type === "@n8n/n8n-nodes-langchain.toolHttpRequest"
);

let changed = 0;
httpTools.forEach((node) => {
  const ph = node.parameters?.placeholderDefinitions?.values || [];
  if (ph.length > 0) return; // already has placeholders

  if (!node.parameters.placeholderDefinitions) {
    node.parameters.placeholderDefinitions = { values: [] };
  }
  node.parameters.placeholderDefinitions.values = [DUMMY_PLACEHOLDER];
  console.log(`✓ ${node.name}: dummy 'chamada' placeholder added.`);
  changed++;
});

if (changed === 0) {
  console.log("Nothing to change — all tools already have placeholders.");
  process.exit(0);
}

fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log(`\n✓ ${changed} node(s) updated. workflow-kCX2-live.json saved.`);

// ---- Verification ----
console.log("\nVerification — all toolHttpRequest nodes:");
httpTools.forEach((n) => {
  const ph = n.parameters?.placeholderDefinitions?.values || [];
  const flag = ph.length === 0 ? "✗ STILL ZERO" : "✓";
  console.log(`  ${flag} ${n.name}: ${ph.map((p) => p.name).join(", ") || "(none)"}`);
});

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
if (!getRes.ok) { console.error("GET failed", getRes.status); process.exit(1); }
const current = await getRes.json();

const putRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: data.name ?? current.name,
    nodes: data.nodes,
    connections: data.connections,
    settings: { executionOrder: current.settings?.executionOrder ?? "v1" },
    staticData: current.staticData ?? undefined,
  }),
});
const text = await putRes.text();
if (!putRes.ok) { console.error("PUT failed", putRes.status, text.substring(0,300)); process.exit(1); }
console.log("✓ Pushed to n8n:", putRes.status, text.slice(0, 150));
