/**
 * Sobrescreve o jsCode do node "Monta Contexto" no n8n ao vivo com a versão
 * correta do arquivo local (workflow-kCX2-live.json).
 *
 * Uso: node patch-fix-monta-contexto.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpPath = path.join(__dirname, "..", ".cursor", "mcp.json");
const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const WORKFLOW_ID = "kCX2LfxJrdYWB0vk";
const LOCAL_FILE = path.join(__dirname, "workflow-kCX2-live.json");

// ── 1. Extrai o jsCode correto do arquivo local ────────────────────────────
const local = JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));

function findMontaContextoCode(nodes) {
  const node = nodes.find(
    (n) => n.name === "Monta Contexto" && n.type === "n8n-nodes-base.code"
  );
  return node?.parameters?.jsCode ?? null;
}

const correctCode =
  findMontaContextoCode(local.nodes ?? []) ??
  findMontaContextoCode(local.activeVersion?.nodes ?? []);

if (!correctCode) {
  console.error("❌ Não encontrei o jsCode do 'Monta Contexto' no arquivo local.");
  process.exit(1);
}

console.log("✅ jsCode local extraído com sucesso.");
console.log(
  "   Prévia:",
  correctCode.slice(0, 120).replace(/\n/g, " ↵ ") + "..."
);

// ── 2. Busca o workflow ao vivo ────────────────────────────────────────────
console.log(`\n📡 GET workflow ${WORKFLOW_ID}...`);
const getRes = await fetch(`${baseUrl}/workflows/${WORKFLOW_ID}`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
if (!getRes.ok) {
  console.error("❌ GET falhou:", getRes.status, await getRes.text());
  process.exit(1);
}
const workflow = await getRes.json();
console.log("✅ Workflow obtido:", workflow.name);

// ── 3. Substitui o jsCode em todos os nodes "Monta Contexto" ──────────────
let patchCount = 0;

function patchNodes(nodes) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (node.name === "Monta Contexto" && node.type === "n8n-nodes-base.code") {
      const before = (node.parameters?.jsCode ?? "").slice(0, 60);
      node.parameters = { ...node.parameters, jsCode: correctCode };
      const after = node.parameters.jsCode.slice(0, 60);
      console.log(`   • Patched node id=${node.id}`);
      console.log(`     Antes:  "${before}..."`);
      console.log(`     Depois: "${after}..."`);
      patchCount++;
    }
  }
}

patchNodes(workflow.nodes);
patchNodes(workflow.activeVersion?.nodes);

if (patchCount === 0) {
  console.error("❌ Nenhum node 'Monta Contexto' encontrado no workflow ao vivo.");
  process.exit(1);
}
console.log(`\n✅ ${patchCount} node(s) patched.`);

// ── 4. PUT o workflow atualizado ───────────────────────────────────────────
const body = {
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: {
    executionOrder: workflow.settings?.executionOrder ?? "v1",
  },
  staticData: workflow.staticData ?? undefined,
};

console.log(`\n📡 PUT workflow ${WORKFLOW_ID}...`);
const putRes = await fetch(`${baseUrl}/workflows/${WORKFLOW_ID}`, {
  method: "PUT",
  headers: {
    "X-N8N-API-KEY": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const text = await putRes.text();
if (!putRes.ok) {
  console.error("❌ PUT falhou:", putRes.status, text.slice(0, 500));
  process.exit(1);
}
console.log("✅ PUT OK", putRes.status);
console.log("   Resultado:", text.slice(0, 200));
