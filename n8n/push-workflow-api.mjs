/**
 * PUT workflow no n8n (usa credenciais do .cursor/mcp.json).
 * Uso: node push-workflow-api.mjs <workflowId|null> <path-to-partial-json> [--activate]
 * Se workflowId for "null", usa o id dentro do JSON (campo id opcional).
 * --activate: POST /workflows/:id/activate (o campo active é read-only no PUT).
 *
 * Sincroniza activeVersion: copia metadados do JSON parcial ou do GET, mas força
 * nodes + connections iguais ao corpo do PUT — evita export local com grafo duplicado
 * divergente (execução a usar snapshot antigo).
 * --with-active-version: tenta enviar activeVersion (muitas instâncias n8n tratam como read-only no PUT).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpPath = path.join(__dirname, "..", ".cursor", "mcp.json");
const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const widArg = process.argv[2];
const filePath = process.argv[3];
if (!filePath) {
  console.error(
    "Usage: node push-workflow-api.mjs <workflowId|null> <json-path> [--activate] [--with-active-version]",
  );
  process.exit(1);
}

const partial = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
const workflowId = widArg && widArg !== "null" ? widArg : partial.id;
if (!workflowId) {
  console.error("Missing workflow id");
  process.exit(1);
}

const getRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
if (!getRes.ok) {
  console.error("GET failed", getRes.status, await getRes.text());
  process.exit(1);
}
const current = await getRes.json();

const nodes = partial.nodes ?? current.nodes;
const connections = partial.connections ?? current.connections;

/** @param {Record<string, unknown>} av */
function buildActiveVersionPayload(av) {
  if (!av || typeof av !== "object") return undefined;
  const { nodes: _dropN, connections: _dropC, ...meta } = av;
  return {
    ...meta,
    workflowId,
    nodes,
    connections,
  };
}

const useActiveVersion = process.argv.includes("--with-active-version");
let activeVersionPayload = undefined;
if (useActiveVersion) {
  activeVersionPayload =
    buildActiveVersionPayload(
      /** @type {Record<string, unknown>} */ (partial.activeVersion),
    ) ??
    buildActiveVersionPayload(
      /** @type {Record<string, unknown>} */ (current.activeVersion),
    );
}

const body = {
  name: partial.name ?? current.name,
  nodes,
  connections,
  // API público só aceita executionOrder; GET devolve binaryMode, callerPolicy, etc.
  settings: {
    executionOrder:
      partial.settings?.executionOrder ??
      current.settings?.executionOrder ??
      "v1",
  },
  staticData: partial.staticData ?? current.staticData ?? undefined,
  ...(activeVersionPayload ? { activeVersion: activeVersionPayload } : {}),
};

if (activeVersionPayload) {
  console.log("activeVersion: nodes+connections aligned with PUT body");
} else if (!useActiveVersion) {
  console.log("activeVersion: not sent (use --with-active-version if your API allows it)");
} else {
  console.log("activeVersion: omitted (no snapshot on partial or server)");
}

const putRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  method: "PUT",
  headers: {
    "X-N8N-API-KEY": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});
const text = await putRes.text();
if (!putRes.ok) {
  console.error("PUT failed", putRes.status, text);
  process.exit(1);
}
console.log("OK", putRes.status, text.slice(0, 500));

if (process.argv.includes("--activate")) {
  const actRes = await fetch(`${baseUrl}/workflows/${workflowId}/activate`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const actText = await actRes.text();
  if (!actRes.ok) {
    console.error("ACTIVATE failed", actRes.status, actText);
    process.exit(1);
  }
  console.log("ACTIVATE", actRes.status, actText.slice(0, 300));
}
