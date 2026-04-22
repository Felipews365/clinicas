/**
 * Corrige a apikey da Evolution API em todos os nodes do workflow.
 * A key hardcoded "14027fe51ef29cdee722fffcd46c94bc" estava retornando 401.
 * A key correta vem do webhook payload: "E24A6298-300E-4794-89C8-23783D858B12"
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");

const OLD_KEY = "14027fe51ef29cdee722fffcd46c94bc";
const NEW_KEY = "E24A6298-300E-4794-89C8-23783D858B12";

// Replace in raw JSON (covers all nodes at once)
const raw = fs.readFileSync(wfPath, "utf8");
const replaced = raw.split(OLD_KEY).join(NEW_KEY);
const count = (raw.match(new RegExp(OLD_KEY, "g")) || []).length;
console.log(`Found ${count} occurrences of old key → replacing all`);

fs.writeFileSync(wfPath, replaced, "utf8");
console.log("✓ Saved.");

// Push to n8n
const data = JSON.parse(replaced);
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const n8nBase = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const n8nKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const wfId = data.id;

const getRes = await fetch(`${n8nBase}/workflows/${wfId}`, { headers: { "X-N8N-API-KEY": n8nKey } });
const current = await getRes.json();

const putRes = await fetch(`${n8nBase}/workflows/${wfId}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": n8nKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: data.name ?? current.name,
    nodes: data.nodes,
    connections: data.connections,
    settings: { executionOrder: current.settings?.executionOrder ?? "v1" },
    staticData: current.staticData ?? undefined,
  }),
});
if (!putRes.ok) { console.error("PUT failed:", await putRes.text()); process.exit(1); }
console.log("✓ Pushed to n8n:", putRes.status, new Date().toISOString());
console.log(`\nNodes atualizados:`);
data.nodes.forEach(n => {
  const str = JSON.stringify(n.parameters || {});
  if (str.includes(NEW_KEY)) console.log(`  - ${n.name}`);
});
