import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const det = await fetch(`${baseUrl}/executions/65086?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

// mensagem
const mc = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
console.log("mensagem:", JSON.stringify(mc?.mensagem));

// Enrich Agendador
const enrichOut = runData["Enrich Agendador"]?.[0]?.data?.main?.[0]?.[0]?.json;
const enrichErr = runData["Enrich Agendador"]?.[0]?.error;
if (enrichErr) {
  console.log("\nEnrich ERROR:", enrichErr.message, enrichErr.description);
} else if (enrichOut) {
  const instr = enrichOut.agent_instructions || "";
  console.log("\nEnrich OK - length:", instr.length);
  console.log("has PROFISSIONAIS:", instr.includes("PROFISSIONAIS"));
  // Show last 400 chars (where profissionais block should be)
  console.log("agent_instructions tail:\n", instr.slice(-500));
} else {
  console.log("\nEnrich: NO DATA");
}

// agente_agendador
const agErr = runData["agente_agendador"]?.[0]?.error;
console.log("\nagente_agendador error:", agErr?.message?.substring(0, 200));
console.log("description:", agErr?.description?.substring(0, 100));

// Check which tools ran
const tools = ["agd_cs_consultar_profissionais","agd_cs_consultar_vagas",
  "agd_cs_consultar_servicos","Refletir agendador"];
tools.forEach(n => {
  const r = runData[n];
  if (r) {
    if (r[0]?.error) console.log(`\n${n} ERROR:`, r[0].error.message?.substring(0, 80));
    else console.log(`\n${n} OK`);
  }
});

console.log("\nAll nodes:", Object.keys(runData).join(", "));
