import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Get clinic_id from exec 65006 (the scheduling error)
const det = await fetch(`${baseUrl}/executions/65006?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
console.log("clinic_id:", mc?.clinic_id);
console.log("remoteJid:", mc?.remoteJid);
console.log("nome_cliente:", mc?.nome_cliente);

// Also from Code merge
const merge = runData["Code merge webhook e resolucao"]?.[0]?.data?.main?.[0]?.[0]?.json;
console.log("\nCode merge clinica_id:", merge?.clinica_id);
