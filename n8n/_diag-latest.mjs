import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Get latest executions
const r = await fetch(`${baseUrl}/executions?workflowId=kCX2LfxJrdYWB0vk&limit=15&includeData=false`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const j = await r.json();

// Find latest error exec
const errExec = (j.data || []).find(e => e.status === "error");
console.log("Last 5 execs:");
(j.data || []).slice(0, 5).forEach(e => {
  const d = (new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000;
  console.log(` ${e.id} ${e.status} ${d.toFixed(1)}s ${e.startedAt}`);
});

if (!errExec) { console.log("No error exec found"); process.exit(0); }
console.log("\nInspecting", errExec.id);

const det = await fetch(`${baseUrl}/executions/${errExec.id}?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

// Enrich Agendador
const enrichOut = runData["Enrich Agendador"]?.[0]?.data?.main?.[0]?.[0]?.json;
const enrichErr = runData["Enrich Agendador"]?.[0]?.error;
if (enrichErr) {
  console.log("\n❌ Enrich FAILED:", enrichErr.message);
} else if (enrichOut) {
  const instr = enrichOut.agent_instructions || "";
  console.log("\n✓ Enrich OK - agent_instructions length:", instr.length);
  console.log("  _profissionais_pre_carregados:", enrichOut._profissionais_pre_carregados);
  console.log("  _servicos_pre_carregados:", enrichOut._servicos_pre_carregados);
  const profIdx = instr.indexOf("PROFISSIONAIS");
  if (profIdx > -1) console.log("  PROFISSIONAIS section:\n" + instr.substring(profIdx, profIdx + 400));
  else console.log("  ❌ No PROFISSIONAIS section in agent_instructions");
} else {
  console.log("\n? Enrich: no output found");
}

// Agent error
const agErr = runData["agente_agendador"]?.[0]?.error;
console.log("\nagente_agendador error:", agErr?.message?.substring(0, 150));

// Which tools ran
["agd_cs_consultar_profissionais","agd_cs_consultar_vagas","agd_cs_consultar_servicos",
 "agd_cs_agendar","agd_cs_buscar_agendamentos"].forEach(n => {
  const runs = runData[n];
  if (!runs) return;
  runs.forEach((run, i) => {
    if (run.error) console.log(`\n❌ TOOL [${n}]#${i}: ${run.error.message?.substring(0, 100)}`);
    else {
      const out = run?.data?.main?.[0]?.[0]?.json;
      console.log(`\n✓ TOOL [${n}]#${i}:`, JSON.stringify(out).substring(0, 100));
    }
  });
});

// mensagem
const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
console.log("\nmensagem:", JSON.stringify(mc?.mensagem));
console.log("clinic_id:", mc?.clinic_id);
