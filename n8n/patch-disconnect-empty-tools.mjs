/**
 * Remove agd_cs_consultar_profissionais e agd_cs_consultar_servicos
 * da lista de tools do agente_agendador.
 *
 * Os dados agora chegam pré-carregados pelo Enrich Agendador (HTTP nodes nativos).
 * Manter essas tools causa "Required → at " porque gpt-4o-mini as chama com args:"".
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const TOOLS_TO_DISCONNECT = ["agd_cs_consultar_profissionais", "agd_cs_consultar_servicos"];

let removed = 0;
TOOLS_TO_DISCONNECT.forEach(toolName => {
  const conn = data.connections[toolName];
  if (!conn) { console.log(`  [SKIP] ${toolName} - no connections found`); return; }

  // ai_tool connections: remove targets pointing to agente_agendador
  if (conn.ai_tool) {
    conn.ai_tool = conn.ai_tool.map(group =>
      group.filter(t => t.node !== "agente_agendador")
    );
  }
  // main connections too (just in case)
  if (conn.main) {
    conn.main = conn.main.map(group =>
      group.filter(t => t.node !== "agente_agendador")
    );
  }

  console.log(`  ✓ Disconnected ${toolName} from agente_agendador`);
  removed++;
});

// Verify remaining tools
const remaining = [];
Object.entries(data.connections).forEach(([from, targets]) => {
  const all = Object.values(targets).flat(2);
  if (all.some(t => t.node === "agente_agendador" && t.type === "ai_tool")) {
    remaining.push(from);
  }
});
console.log("\nRemaining tools for agente_agendador:", remaining);

fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log("✓ Saved.");

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
