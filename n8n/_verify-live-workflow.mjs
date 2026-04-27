import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const id = "kCX2LfxJrdYWB0vk";

console.log("API base:", baseUrl);
console.log(
  "É o host vps7846?",
  baseUrl.startsWith("https://n8n.vps7846.panel.icontainer.cloud")
);

const r = await fetch(`${baseUrl}/workflows/${id}`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
console.log("GET /workflows/" + id + " →", r.status);
if (!r.ok) {
  console.log(await r.text());
  process.exit(1);
}
const w = await r.json();
console.log("Workflow:", w.name, "| updatedAt:", w.updatedAt);

const nodes = w.nodes || [];
const monta = nodes.find((n) => n.name === "Monta Contexto");
const ag = nodes.find((n) => n.name === "agente_agendador");
const mc = monta?.parameters?.jsCode || "";
const sm = ag?.parameters?.options?.systemMessage || "";

console.log("Monta Contexto: tem _ymdSP?", mc.includes("function _ymdSP"));
console.log("Monta Contexto: tem cal_amanha_ymd no código?", mc.includes("cal_amanha_ymd"));
console.log(
  "agente_agendador: SM tem CALENDÁRIO (obrigatório)?",
  sm.includes("CALENDÁRIO (obrigatório)")
);
console.log("agente_agendador: SM tem {{ $json.cal_amanha_ymd }}?", sm.includes("cal_amanha_ymd"));
