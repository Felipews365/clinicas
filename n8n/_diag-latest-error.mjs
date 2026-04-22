import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const wfId = "kCX2LfxJrdYWB0vk";

// Get last 50 executions
const res = await fetch(`${baseUrl}/executions?workflowId=${wfId}&limit=50&includeData=false`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const j = await res.json();
const errors = (j.data || []).filter(e => e.status === "error");
const longErrors = errors.filter(e => {
  const dur = e.stoppedAt ? (new Date(e.stoppedAt) - new Date(e.startedAt)) : 0;
  return dur > 500;
});

if (!longErrors.length) { console.log("No error executions found."); process.exit(0); }

const latest = longErrors[0];
console.log(`Latest error: id=${latest.id} at ${latest.startedAt} dur=${((new Date(latest.stoppedAt)-new Date(latest.startedAt))/1000).toFixed(1)}s`);

// Get full detail
const detRes = await fetch(`${baseUrl}/executions/${latest.id}?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const det = await detRes.json();
const runData = det.data?.resultData?.runData || {};

// Find which tool node was running when error occurred
const agentRun = runData["agente_agendador"]?.[0];
console.log("\nagente_agendador error:", agentRun?.error?.message?.substring(0, 200));

// Look for which tool nodes actually ran vs which didn't
const toolNodes = ["agd_cs_buscar_agendamentos","agd_cs_consultar_vagas","agd_cs_consultar_servicos",
  "agd_cs_consultar_profissionais","agd_cs_agendar","agd_cs_reagendar","agd_cs_cancelar",
  "agd_cs_notificar_profissional","Refletir agendador"];

console.log("\nTool node execution status:");
toolNodes.forEach(name => {
  const run = runData[name];
  if (run) {
    const err = run[0]?.error;
    console.log(` ✓ ${name}: ran ${run.length}x${err ? ' ERROR:'+err.message?.substring(0,60) : ''}`);
  } else {
    console.log(` - ${name}: did not run (or ran inside agent)`);
  }
});

// Print the AI input that went to the LLM (what was the user's message)
const mcRun = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
if (mcRun) {
  console.log("\nMonta Contexto mensagem:", JSON.stringify(mcRun.mensagem));
  console.log("agent_instructions prefix:", mcRun.agent_instructions?.substring(0,80));
}

// Check agente_atende_qualifica output (which tool call triggered agendador)
const qualRun = runData["agente_atende_qualifica"]?.[0]?.data?.main?.[0]?.[0]?.json;
if (qualRun) {
  console.log("\nQualifica agent output:", JSON.stringify(qualRun.output)?.substring(0,150));
  console.log("Qualifica rota:", qualRun.rota);
}
