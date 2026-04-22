import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const wfId = "kCX2LfxJrdYWB0vk";

// Wait for a new execution after 16:58 UTC
const cutoff = new Date("2026-04-21T16:58:00.000Z");
console.log("Monitoring executions after", cutoff.toISOString(), "...");

for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 3000));
  const res = await fetch(`${baseUrl}/executions?workflowId=${wfId}&limit=5&includeData=false`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const j = await res.json();
  const newExecs = (j.data || []).filter(e => new Date(e.startedAt) > cutoff && ((new Date(e.stoppedAt) - new Date(e.startedAt)) > 1000));

  if (newExecs.length === 0) { process.stdout.write("."); continue; }

  console.log(`\nFound ${newExecs.length} new execution(s):`);
  for (const exec of newExecs) {
    const dur = ((new Date(exec.stoppedAt) - new Date(exec.startedAt))/1000).toFixed(1);
    console.log(`\n  id=${exec.id} status=${exec.status} dur=${dur}s`);

    const det = await fetch(`${baseUrl}/executions/${exec.id}?includeData=true`, {
      headers: { "X-N8N-API-KEY": apiKey },
    });
    const d = await det.json();
    const runData = d.data?.resultData?.runData || {};

    // Enrich Agendador
    const enrichRun = runData["Enrich Agendador"];
    if (enrichRun) {
      const out = enrichRun[0]?.data?.main?.[0]?.[0]?.json;
      const err = enrichRun[0]?.error;
      if (err) console.log("  Enrich Agendador ERROR:", err.message?.substring(0, 150));
      else {
        const instr = out?.agent_instructions || "";
        const hasProfIds = instr.includes("profissional_id:");
        const hasServIds = instr.includes("servico_id:");
        console.log(`  Enrich Agendador: profissionais_ids=${hasProfIds} servicos_ids=${hasServIds}`);
        if (hasProfIds) console.log("  Profissionais preview:", instr.match(/## PROFISSIONAIS[^\n]*\n[^\n]*/)?.[0]);
      }
    } else {
      console.log("  Enrich Agendador: did not run");
    }

    // agente_agendador
    const agErr = runData["agente_agendador"]?.[0]?.error;
    const agOut = runData["agente_agendador"]?.[0]?.data?.main?.[0]?.[0]?.json?.output;
    if (agErr) console.log("  agente_agendador ERROR:", agErr.message?.substring(0, 200));
    else if (agOut) console.log("  agente_agendador OUTPUT:", String(agOut).substring(0, 150));

    // Tool runs
    ["agd_cs_consultar_profissionais","agd_cs_consultar_vagas","agd_cs_agendar","agd_cs_consultar_servicos"].forEach(name => {
      const runs = runData[name];
      if (!runs) return;
      runs.forEach((run, i) => {
        if (run.error) console.log(`  TOOL ERROR [${name}]: ${run.error.message?.substring(0,80)}`);
        else {
          const out = run?.data?.main?.[0]?.[0]?.json;
          if (out) console.log(`  TOOL OK [${name}]: ${JSON.stringify(out).substring(0,80)}`);
        }
      });
    });

    const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
    if (mc) console.log("  mensagem:", JSON.stringify(mc.mensagem));
  }
  break;
}
