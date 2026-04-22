import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const r = await fetch(`${baseUrl}/executions?workflowId=kCX2LfxJrdYWB0vk&limit=10&includeData=false`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const j = await r.json();
const errExec = (j.data || []).find(e => e.status === "error");
console.log("Last 5:", (j.data||[]).slice(0,5).map(e=>`${e.id}(${e.status} ${((new Date(e.stoppedAt)-new Date(e.startedAt))/1000).toFixed(1)}s)`).join(", "));
if (!errExec) { console.log("No errors"); process.exit(0); }
console.log("\nInspecting", errExec.id);

const det = await fetch(`${baseUrl}/executions/${errExec.id}?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

// Full agent error details
const agRun = runData["agente_agendador"]?.[0];
console.log("\nagente_agendador error:", agRun?.error?.message?.substring(0, 200));
console.log("agente_agendador error stack:", agRun?.error?.stack?.substring(0, 500));

// ALL nodes, highlight errors
console.log("\n=== All nodes ===");
Object.entries(runData).forEach(([name, runs]) => {
  const r0 = runs[0];
  if (r0?.error) {
    console.log(`  ❌ ${name}: ${r0.error.message?.substring(0, 100)}`);
  }
});

// Memory agendador output - check stored history
const memOut = runData["Memory agendador"]?.[0];
console.log("\nMemory agendador status:", memOut?.error ? "ERROR: "+memOut.error.message : "ok (no main output)");

// Check Enrich output
const enrichOut = runData["Enrich Agendador"]?.[0]?.data?.main?.[0]?.[0]?.json;
if (enrichOut) {
  console.log("\nEnrich: _profissionais=", enrichOut._profissionais_pre_carregados, "_servicos=", enrichOut._servicos_pre_carregados);
  const instr = enrichOut.agent_instructions || "";
  console.log("agent_instructions has PROFISSIONAIS:", instr.includes("PROFISSIONAIS"));
  console.log("agent_instructions has SERVIÇOS:", instr.includes("SERVIÇOS"));
}

// Check if Memory node has error
const memErr = runData["Memory agendador"]?.[0]?.error;
if (memErr) console.log("Memory ERROR:", memErr.message);

// Get the agente_agendador input to see what LangChain received
const agInput = runData["agente_agendador"]?.[0]?.data;
console.log("\nagente_agendador data keys:", Object.keys(agInput || {}));
