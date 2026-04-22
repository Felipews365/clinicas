import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const wfId = "kCX2LfxJrdYWB0vk";

const res = await fetch(`${baseUrl}/executions?workflowId=${wfId}&limit=20&includeData=false`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const j = await res.json();

console.log("=== Últimas 20 execuções ===");
for (const e of (j.data || [])) {
  const dur = e.stoppedAt ? ((new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000).toFixed(1) : "?";
  console.log(`id=${e.id} status=${e.status} dur=${dur}s at=${e.startedAt}`);
}

// Get the most recent error executions (dur > 1s)
const errors = (j.data || []).filter(e => e.status === "error");
const longExecs = (j.data || []).filter(e => {
  const dur = e.stoppedAt ? (new Date(e.stoppedAt) - new Date(e.startedAt)) : 0;
  return dur > 1000;
});

console.log(`\n${errors.length} error(s), ${longExecs.length} long executions`);

// Deep inspect the 3 most recent relevant executions
const toInspect = [...new Set([...errors.slice(0,3), ...longExecs.slice(0,2)])].slice(0,4);

for (const exec of toInspect) {
  console.log(`\n===== Exec ${exec.id} (${exec.status}, ${((new Date(exec.stoppedAt)-new Date(exec.startedAt))/1000).toFixed(1)}s) =====`);
  const det = await fetch(`${baseUrl}/executions/${exec.id}?includeData=true`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const d = await det.json();
  const runData = d.data?.resultData?.runData || {};

  // Find mensagem
  const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
  if (mc) console.log(`  mensagem: "${String(mc.mensagem).substring(0,80)}"`);

  // Find agente_agendador error
  const agErr = runData["agente_agendador"]?.[0]?.error;
  if (agErr) {
    console.log(`  agente_agendador ERROR: ${agErr.message?.substring(0,200)}`);
    console.log(`  description: ${agErr.description?.substring(0,200)}`);
    if (agErr.stack) console.log(`  stack[0]: ${agErr.stack.split('\n')[0]}`);
  }

  // Find the specific tool that errored
  const toolNames = ["agd_cs_buscar_agendamentos","agd_cs_consultar_vagas","agd_cs_consultar_servicos",
    "agd_cs_consultar_profissionais","agd_cs_agendar","agd_cs_reagendar","agd_cs_cancelar",
    "agd_cs_notificar_profissional","Refletir agendador"];

  let hasToolRun = false;
  toolNames.forEach(name => {
    const runs = runData[name];
    if (!runs) return;
    hasToolRun = true;
    runs.forEach((run, i) => {
      if (run.error) {
        console.log(`  TOOL ERROR [${name}] run${i}: ${run.error.message?.substring(0,120)}`);
        console.log(`    desc: ${run.error.description?.substring(0,150)}`);
        const inp = run?.data?.main?.[0]?.[0]?.json || run.inputData;
        if (inp) console.log(`    input: ${JSON.stringify(inp).substring(0,200)}`);
      } else {
        const out = run?.data?.main?.[0]?.[0]?.json;
        if (out) console.log(`  TOOL OK [${name}] run${i}: ${JSON.stringify(out).substring(0,120)}`);
      }
    });
  });

  if (!hasToolRun) console.log("  (no tool sub-nodes in runData)");

  // Which nodes ran
  const allRan = Object.keys(runData);
  console.log(`  Nodes: ${allRan.join(", ")}`);
}
