import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const det = await fetch(`${baseUrl}/executions/65166?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();

// Dump entire runData["agente_agendador"][0] WITHOUT truncating
const agRun = d.data?.resultData?.runData?.["agente_agendador"]?.[0];
console.log("=== Full agRun object (keys) ===");
console.log(Object.keys(agRun || {}));
console.log("\n=== agRun.error (full) ===");
console.log(JSON.stringify(agRun?.error, null, 2));
console.log("\n=== agRun.data ===");
console.log(JSON.stringify(agRun?.data, null, 2).substring(0, 2000));
console.log("\n=== agRun.inputOverride ===");
console.log(JSON.stringify(agRun?.inputOverride, null, 2).substring(0, 2000));

// See full resultData keys
console.log("\n=== resultData keys ===");
console.log(Object.keys(d.data?.resultData || {}));
