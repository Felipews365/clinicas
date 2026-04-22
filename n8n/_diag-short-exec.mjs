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

console.log("=== 10 execuções mais recentes ===");
for (const e of (j.data || [])) {
  const dur = e.stoppedAt ? ((new Date(e.stoppedAt) - new Date(e.startedAt)) / 1000).toFixed(1) : "?";
  console.log(`id=${e.id} status=${e.status} dur=${dur}s at=${e.startedAt}`);
}

// Pegar as 2 mais recentes com detalhe completo
const recents = (j.data || []).slice(0, 3);
for (const exec of recents) {
  console.log(`\n===== Exec ${exec.id} (${exec.status}, ${((new Date(exec.stoppedAt)-new Date(exec.startedAt))/1000).toFixed(2)}s) =====`);
  const det = await fetch(`${baseUrl}/executions/${exec.id}?includeData=true`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const d = await det.json();
  const runData = d.data?.resultData?.runData || {};

  // Mostrar quais nós rodaram e seus outputs resumidos
  const nodeOrder = [
    "Webhook","Filter1","Edit Fields1","Code Normalizar Evolution Clinica","IF evento e mensagem",
    "HTTP RPC n8n_resolve_clinic","Switch Clinica id valido","CRM Cliente com id?",
    "Edit Fields2","Monta Contexto","IF mensagem válida","Switch Rota",
    "agente_atende_qualifica","Code Extrair Rota","agente_agendador"
  ];

  nodeOrder.forEach(name => {
    const run = runData[name];
    if (!run) return;
    const out = run[0]?.data?.main?.[0]?.[0]?.json;
    const err = run[0]?.error;
    if (err) {
      console.log(`  ✗ ${name}: ERROR = ${err.message?.substring(0,100)}`);
    } else if (out) {
      const keys = Object.keys(out).slice(0,5).join(", ");
      const msg = out.mensagem !== undefined ? ` mensagem="${String(out.mensagem).substring(0,40)}"` : "";
      const rota = out.rota !== undefined ? ` rota="${out.rota}"` : "";
      const output = out.output !== undefined ? ` output="${String(out.output).substring(0,60)}"` : "";
      console.log(`  ✓ ${name}: [${keys}]${msg}${rota}${output}`);
    } else {
      // Pode ter saído pelo branch false/1/2
      const allBranches = run[0]?.data?.main || [];
      const branchInfo = allBranches.map((b, i) => `branch${i}:${b?.length ?? 0}items`).join(" ");
      console.log(`  ✓ ${name}: ${branchInfo || "(sem output main[0][0])"}`);
    }
  });

  // Último nó que rodou
  const allRan = Object.keys(runData);
  console.log(`  Nós que rodaram: ${allRan.join(", ")}`);
}
