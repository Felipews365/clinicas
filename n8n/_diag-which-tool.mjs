import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const det = await fetch(`${baseUrl}/executions/65131?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

// Show all nodes that ran
console.log("=== All nodes in exec 65131 ===");
Object.entries(runData).forEach(([name, runs]) => {
  const run = runs[0];
  const hasErr = !!run?.error;
  const outItems = run?.data?.main?.[0]?.length || 0;
  const errMsg = hasErr ? run.error.message?.substring(0, 80) : '';
  console.log(`  [${hasErr ? 'ERR' : ' OK'}] ${name}: ${outItems} items ${errMsg}`);
});

// Enrich Agendador - show agent_instructions tail
const enrichOut = runData["Enrich Agendador"]?.[0]?.data?.main?.[0]?.[0]?.json;
if (enrichOut) {
  const instr = enrichOut.agent_instructions || "";
  console.log("\n=== agent_instructions tail (last 600 chars) ===");
  console.log(instr.slice(-600));
  console.log("\n_profissionais:", enrichOut._profissionais_pre_carregados);
  console.log("_servicos:", enrichOut._servicos_pre_carregados);
}

// Check HTTP Fetch nodes
["HTTP Fetch Profissionais", "HTTP Fetch Servicos"].forEach(name => {
  const run = runData[name]?.[0];
  if (!run) return;
  if (run.error) {
    console.log(`\n${name} ERROR:`, run.error.message);
  } else {
    const out = run?.data?.main?.[0]?.[0]?.json;
    const dataLen = out?.data?.length || 0;
    console.log(`\n${name} OK: data length=${dataLen}, sample:`, JSON.stringify(out).substring(0, 100));
  }
});
