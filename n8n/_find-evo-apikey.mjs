import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "workflow-kCX2-live.json"), "utf8"));

// Check HTTP Request1 - uses webhook apikey
const httpReq1 = data.nodes.find(n => n.name === "HTTP Request1");
if (httpReq1) {
  console.log("HTTP Request1 headers:", JSON.stringify(httpReq1.parameters?.headerParameters?.parameters));
  console.log("HTTP Request1 url:", httpReq1.parameters?.url?.substring(0,100));
}

// Check "Buscar Config Clínica" - might store evo apikey
const bcc = data.nodes.find(n => n.name === "Buscar Config Clínica");
if (bcc) console.log("\nBuscar Config Clínica:", JSON.stringify(bcc.parameters?.url, null, 2).substring(0,200));

// Check "Code Normalizar Evolution Clinica" or similar
const codeNodes = data.nodes.filter(n => n.type === "n8n-nodes-base.code" && n.name.toLowerCase().includes("normaliz"));
codeNodes.forEach(n => {
  console.log(`\n${n.name} code:`, n.parameters?.jsCode?.substring(0, 300));
});

// Check env variables via n8n API
const envRes = await fetch(`${baseUrl}/variables`, { headers: { "X-N8N-API-KEY": apiKey } });
const envData = await envRes.json();
if (envData?.data?.length) {
  console.log("\n=== n8n variables ===");
  (envData.data || []).forEach(v => {
    if (v.key.toLowerCase().includes("evo") || v.key.toLowerCase().includes("evolution") || v.key.toLowerCase().includes("apikey")) {
      console.log(` ${v.key}: ${v.value?.substring(0,40)}`);
    }
  });
}

// Check the Buscar Config Clínica output fields
const gcNode = data.nodes.find(n => n.name === "Get Empresa");
if (gcNode) console.log("\nGet Empresa:", JSON.stringify(gcNode.parameters).substring(0,200));

// Check all httpRequest nodes with evo URL
data.nodes.filter(n => JSON.stringify(n.parameters?.url || '').includes('evo.')).forEach(n => {
  const headers = n.parameters?.headerParameters?.parameters || n.parameters?.parametersHeaders?.values || [];
  const apiKeyHeader = headers.find(h => h.name?.toLowerCase() === 'apikey');
  console.log(`\n${n.name}:`);
  console.log(`  url: ${JSON.stringify(n.parameters?.url).substring(0,80)}`);
  console.log(`  apikey: ${JSON.stringify(apiKeyHeader?.value).substring(0,80)}`);
});
