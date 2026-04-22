import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Get Supabase credential SmHWpBnyL1cYuhlm
const res = await fetch(`${baseUrl}/credentials/SmHWpBnyL1cYuhlm`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
console.log("status:", res.status);
const j = await res.json();
console.log("cred data:", JSON.stringify(j, null, 2));

// Also get agente_agendador node full params (especially systemMessage and options)
const wf = JSON.parse(fs.readFileSync("e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json", "utf8"));
const ag = wf.nodes.find(n => n.name === "agente_agendador");
console.log("\nagente_agendador full params (keys):", Object.keys(ag?.parameters || {}));
console.log("systemMessage:", JSON.stringify(ag?.parameters?.systemMessage)?.substring(0, 200));
console.log("options:", JSON.stringify(ag?.parameters?.options)?.substring(0, 300));
console.log("text:", JSON.stringify(ag?.parameters?.text)?.substring(0, 100));
