import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Get LIVE workflow from n8n (not local file)
const r = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, { headers: { "X-N8N-API-KEY": apiKey } });
const liveWf = await r.json();
const c = liveWf.connections || {};

console.log("=== Live connections for agd_cs_consultar_profissionais ===");
console.log(JSON.stringify(c["agd_cs_consultar_profissionais"], null, 2));

console.log("\n=== Live connections for agd_cs_consultar_servicos ===");
console.log(JSON.stringify(c["agd_cs_consultar_servicos"], null, 2));

console.log("\n=== Live connections for agente_agendador ===");
console.log(JSON.stringify(c["agente_agendador"], null, 2));

// Show what connects TO agente_agendador (all types)
console.log("\n=== All connections pointing to agente_agendador ===");
Object.entries(c).forEach(([from, targets]) => {
  const str = JSON.stringify(targets);
  if (str.includes("agente_agendador")) {
    console.log(`FROM: "${from}":`);
    console.log(JSON.stringify(targets, null, 2).substring(0, 300));
    console.log();
  }
});
