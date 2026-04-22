import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const r = await fetch(`${baseUrl}/executions?workflowId=kCX2LfxJrdYWB0vk&limit=20&includeData=false`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const j = await r.json();
console.log("Last 15:");
(j.data || []).slice(0, 15).forEach(e => {
  const d = (new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000;
  console.log(` ${e.id} ${e.status} ${d.toFixed(1)}s ${e.startedAt}`);
});

// Find latest long exec (>= 3s = went to an agent)
const longExecs = (j.data || []).filter(e => {
  const d = (new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000;
  return d > 3;
});
if (!longExecs.length) { console.log("No long execs"); process.exit(0); }

const exec = longExecs[0];
console.log(`\nInspecting ${exec.id} (${exec.status})`);

const det = await fetch(`${baseUrl}/executions/${exec.id}?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

// Which tools ran
console.log("\n=== Tool runs ===");
["agd_cs_buscar_agendamentos","agd_cs_consultar_vagas","agd_cs_agendar",
 "agd_cs_reagendar","agd_cs_cancelar","agd_cs_notificar_profissional"].forEach(name => {
  const runs = runData[name];
  if (!runs) return;
  runs.forEach((run, i) => {
    if (run.error) {
      console.log(`  ❌ ${name}#${i}: ${run.error.message?.substring(0, 150)}`);
      console.log(`     description: ${run.error.description?.substring(0,150)}`);
    } else {
      const out = run?.data?.main?.[0]?.[0]?.json;
      console.log(`  ✓  ${name}#${i}:`, JSON.stringify(out).substring(0, 200));
    }
  });
});

const agErr = runData["agente_agendador"]?.[0]?.error;
if (agErr) console.log("\nAgent error:", agErr.message?.substring(0,200));
const agOut = runData["agente_agendador"]?.[0]?.data?.main?.[0]?.[0]?.json;
if (agOut) console.log("\nAgent output:", JSON.stringify(agOut).substring(0,300));

// Monta contexto
const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
console.log("\nmensagem:", mc?.mensagem);

// Check the answer/response path  
const ans = runData["Separa 1 mensagem para enviar"]?.[0]?.data?.main?.[0];
if (ans) console.log("\nResposta enviada:", JSON.stringify(ans).substring(0,200));
