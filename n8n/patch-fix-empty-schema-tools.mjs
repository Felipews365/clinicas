/**
 * Fix: "Received tool input did not match expected schema ✖ Required → at "
 *
 * Root cause (confirmed via execution 64945, 16:01 UTC):
 *   agd_cs_consultar_servicos and agd_cs_consultar_profissionais have ZERO placeholder
 *   definitions → Zod schema is z.object({}) (empty).
 *
 *   gpt-4o-mini calls empty-schema functions with `arguments: ""` (empty string) instead
 *   of `"{}"`. LangChain classic 1.0.5 does JSON.parse("") → SyntaxError → toolInput
 *   stays undefined → z.object({}).safeParse(undefined) → "Required → at " (empty path).
 *
 * Fix:
 *   Add a single dummy placeholder ("chamada") to each no-placeholder tool.
 *   Schema becomes z.object({ chamada: z.string() }).
 *   OpenAI now sends {"chamada": ""} → JSON.parse succeeds → validation passes.
 *   The {chamada} pattern does NOT appear in the tool's URL or jsonBody, so n8n
 *   silently discards it and makes the HTTP request unchanged.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const DUMMY_PLACEHOLDER = {
  name: "chamada",
  description: "Sempre passe uma string vazia \"\". Este parâmetro é obrigatório pelo schema mas ignorado na requisição.",
  type: "string",
};

const TARGET_TOOLS = ["agd_cs_consultar_servicos", "agd_cs_consultar_profissionais"];

let changed = 0;
TARGET_TOOLS.forEach((name) => {
  const node = data.nodes.find((n) => n.name === name);
  if (!node) { console.error(`Node '${name}' not found!`); return; }

  const ph = node.parameters.placeholderDefinitions?.values || [];
  const alreadyHasDummy = ph.some((p) => p.name === "chamada");

  if (alreadyHasDummy) {
    console.log(`✓ ${name}: dummy placeholder already present.`);
    return;
  }

  if (ph.length > 0) {
    console.log(`⚠ ${name}: has ${ph.length} placeholders — this fix is for zero-placeholder tools only. Skipping.`);
    return;
  }

  // Ensure placeholderDefinitions exists
  if (!node.parameters.placeholderDefinitions) {
    node.parameters.placeholderDefinitions = { values: [] };
  }
  node.parameters.placeholderDefinitions.values = [DUMMY_PLACEHOLDER];

  console.log(`✓ ${name}: dummy 'chamada' placeholder added.`);
  changed++;
});

if (changed === 0) {
  console.log("Nothing to change.");
  process.exit(0);
}

// ---- Save ----
fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log("✓ workflow-kCX2-live.json saved.");

// ---- Verify ----
console.log("\nVerification:");
TARGET_TOOLS.forEach((name) => {
  const node = data.nodes.find((n) => n.name === name);
  const ph = node?.parameters?.placeholderDefinitions?.values || [];
  console.log(`  ${name}: ${ph.length} placeholder(s) →`, ph.map((p) => p.name).join(", "));
});

// ---- Push to n8n ----
const mcpPath = path.join(__dirname, "..", ".cursor", "mcp.json");
const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const workflowId = data.id;

console.log(`\nPushing workflow ${workflowId} to n8n...`);
const getRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
if (!getRes.ok) { console.error("GET failed", getRes.status); process.exit(1); }
const current = await getRes.json();

const putRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  method: "PUT",
  headers: { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: data.name ?? current.name,
    nodes: data.nodes,
    connections: data.connections,
    settings: { executionOrder: current.settings?.executionOrder ?? "v1" },
    staticData: current.staticData ?? undefined,
  }),
});
const text = await putRes.text();
if (!putRes.ok) { console.error("PUT failed", putRes.status, text); process.exit(1); }
console.log("✓ Pushed to n8n:", putRes.status, text.slice(0, 200));
