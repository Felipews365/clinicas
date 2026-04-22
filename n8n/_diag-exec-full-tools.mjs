import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const execId = process.argv[2] || "65730";

const det = await fetch(`${baseUrl}/executions/${execId}?includeData=true`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
const d = await det.json();
const runData = d.data?.resultData?.runData || {};

const agdTools = [
  "agd_cs_buscar_agendamentos",
  "agd_cs_consultar_vagas",
  "agd_cs_consultar_servicos",
  "agd_cs_consultar_profissionais",
  "agd_cs_agendar",
  "agd_cs_reagendar",
  "agd_cs_cancelar",
  "agd_cs_notificar_profissional",
];

console.log("=== Tool runs (in node name order, multiple runs per node) ===\n");
for (const name of agdTools) {
  const runs = runData[name];
  if (!runs) continue;
  runs.forEach((run, i) => {
    const err = run.error;
    const j = run?.data?.ai_tool?.[0]?.[0]?.json;
    const status = err ? `FAIL: ${err.message?.slice(0, 120)}` : "ok";
    console.log(`${name} #${i}: ${status}`);
    if (j && typeof j === "object") {
      const keys = Object.keys(j);
      console.log(`  keys: ${keys.join(", ")}`);
      if (j.input != null) console.log(`  input: ${JSON.stringify(j.input).slice(0, 300)}`);
      if (j.response != null) console.log(`  response: ${String(j.response).slice(0, 400)}`);
    }
  });
}

// consultar_vagas full response for slot analysis
const vagas = runData["agd_cs_consultar_vagas"];
if (vagas) {
  console.log("\n=== agd_cs_consultar_vagas raw ===");
  vagas.forEach((run, i) => {
    const j = run?.data?.ai_tool?.[0]?.[0]?.json;
    console.log(`#${i} response length:`, String(j?.response || "").length);
    console.log(String(j?.response || "").slice(0, 1500));
  });
}
