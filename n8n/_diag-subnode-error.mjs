import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Exec 64952 - last error
const execId = 64952;
const det = await fetch(`${baseUrl}/executions/${execId}?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

// Full error from agente_agendador
const agentRuns = runData["agente_agendador"];
if (agentRuns) {
  const run = agentRuns[0];
  console.log("=== agente_agendador error ===");
  console.log(JSON.stringify(run?.error, null, 2));
}

// Full error from agd_cs_consultar_profissionais
const toolRuns = runData["agd_cs_consultar_profissionais"];
if (toolRuns) {
  console.log("\n=== agd_cs_consultar_profissionais ===");
  toolRuns.forEach((run, i) => {
    console.log(`Run ${i}:`);
    if (run.error) console.log("  ERROR:", JSON.stringify(run.error, null, 2));
    const out = run?.data?.main?.[0]?.[0]?.json;
    if (out) console.log("  OUTPUT:", JSON.stringify(out).substring(0, 300));
  });
} else {
  console.log("\nagd_cs_consultar_profissionais NOT in runData");
}

// Check the full node parameters for agd_cs_consultar_profissionais
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const wf = JSON.parse(fs.readFileSync(wfPath, "utf8"));
const toolNode = wf.nodes.find(n => n.name === "agd_cs_consultar_profissionais");
console.log("\n=== agd_cs_consultar_profissionais node parameters ===");
console.log("method:", toolNode?.parameters?.method);
console.log("url (first 150):", String(toolNode?.parameters?.url || "").substring(0, 150));
console.log("headers:", JSON.stringify(toolNode?.parameters?.headerParameters || {}));
console.log("sendHeaders:", toolNode?.parameters?.sendHeaders);
console.log("authentication:", toolNode?.parameters?.authentication);
console.log("placeholders:", JSON.stringify(toolNode?.parameters?.placeholderDefinitions?.values));
