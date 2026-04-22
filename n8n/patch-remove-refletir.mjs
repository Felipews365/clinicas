/**
 * Remove Refletir agendador (toolThink) do agente_agendador.
 * toolThink tem schema {thought: string}. Quando gpt-4o-mini chama com args:""
 * (JSON.parse("") → undefined), Zod falha com "Required → at " (path vazio).
 * 
 * O agent_instructions já guia o raciocínio; toolThink é redundante.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

// Disconnect Refletir agendador from agente_agendador
const conn = data.connections["Refletir agendador"];
if (conn?.ai_tool) {
  conn.ai_tool = conn.ai_tool.map(group =>
    group.filter(t => t.node !== "agente_agendador")
  );
  console.log("✓ Disconnected Refletir agendador from agente_agendador");
}

// Also check other toolThink nodes connected to other agents (Refletir qualifica, etc)
["Refletir qualifica","Refletir faq","Refletir esp"].forEach(name => {
  const c = data.connections[name];
  if (c?.ai_tool) {
    const before = JSON.stringify(c.ai_tool);
    c.ai_tool = c.ai_tool.map(g => g.filter(t => !["agente_atende_qualifica","agente_faq","agente_esp"].includes(t.node)));
    if (before !== JSON.stringify(c.ai_tool)) console.log(`✓ Also disconnected ${name}`);
  }
});

// Verify remaining
const remaining = [];
Object.entries(data.connections).forEach(([from, targets]) => {
  const all = Object.values(targets).flat(2);
  if (all.some(t => t.node === "agente_agendador" && t.type === "ai_tool")) {
    remaining.push(from);
  }
});
console.log("Remaining tools for agente_agendador:", remaining);

fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");

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
