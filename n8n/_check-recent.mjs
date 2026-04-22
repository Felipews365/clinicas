import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const wfId = "kCX2LfxJrdYWB0vk";

const res = await fetch(`${baseUrl}/executions?workflowId=${wfId}&limit=10&includeData=false`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const j = await res.json();
console.log("Últimas 10 execuções:");
for (const e of (j.data || [])) {
  const dur = e.stoppedAt ? ((new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000).toFixed(1) : "?";
  console.log(`  id=${e.id} status=${e.status} dur=${dur}s at=${e.startedAt}`);
}

// Get the latest long/error one
const interesting = (j.data || []).filter(e => {
  const dur = e.stoppedAt ? (new Date(e.stoppedAt) - new Date(e.startedAt)) : 0;
  return dur > 2000;
}).slice(0, 3);

for (const exec of interesting) {
  const det = await fetch(`${baseUrl}/executions/${exec.id}?includeData=true`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const d = await det.json();
  const runData = d.data?.resultData?.runData || {};
  const dur = ((new Date(exec.stoppedAt) - new Date(exec.startedAt))/1000).toFixed(1);
  console.log(`\n=== Exec ${exec.id} (${exec.status}, ${dur}s) ===`);
  const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
  if (mc) console.log("  mensagem:", JSON.stringify(mc.mensagem));

  const enrichRun = runData["Enrich Agendador"];
  if (enrichRun) {
    const out = enrichRun[0]?.data?.main?.[0]?.[0]?.json;
    const err = enrichRun[0]?.error;
    if (err) console.log("  Enrich ERROR:", err.message?.substring(0,150));
    else {
      const instr = out?.agent_instructions || "";
      console.log("  Enrich: has profissional_id:", instr.includes("profissional_id:"));
      const match = instr.match(/## PROFISSIONAIS[^\n]*\n((?:[^\n]+\n?){1,5})/);
      if (match) console.log("  Profissionais:\n   ", match[0].substring(0,200));
    }
  } else {
    console.log("  Enrich Agendador: NOT in runData (node not reached?)");
  }

  const agErr = runData["agente_agendador"]?.[0]?.error;
  const agOut = runData["agente_agendador"]?.[0]?.data?.main?.[0]?.[0]?.json?.output;
  if (agErr) console.log("  agente_agendador ERROR:", agErr.message?.substring(0,200));
  else if (agOut) console.log("  agente_agendador OK:", String(agOut).substring(0,200));

  console.log("  Nodes:", Object.keys(runData).join(", ").substring(0,200));
}
