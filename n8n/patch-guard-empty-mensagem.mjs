/**
 * Adiciona um nó IF entre Switch Rota e agente_agendador.
 * Bloqueia a execução do agent quando mensagem está vazia (áudio sem transcrição,
 * imagem, eventos de status, etc.) evitando tool calls malformados.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

const GUARD_ID = "guard-if-mensagem-valida";
const GUARD_NAME = "IF mensagem válida";

// Idempotency check
if (data.nodes.find((n) => n.id === GUARD_ID)) {
  console.log("Guard already present. Nothing to do.");
  process.exit(0);
}

// ---- 1. Add the IF node ----
const ifNode = {
  id: GUARD_ID,
  name: GUARD_NAME,
  type: "n8n-nodes-base.if",
  typeVersion: 2.2,
  position: [1000, -128],
  parameters: {
    conditions: {
      options: {
        caseSensitive: false,
        leftValue: "",
        typeValidation: "loose",
        version: 2,
      },
      conditions: [
        {
          id: "guard-cond-1",
          leftValue: "={{ $json.mensagem }}",
          rightValue: "",
          operator: {
            type: "string",
            operation: "notEmpty",
          },
        },
      ],
      combinator: "and",
    },
    options: {},
  },
};

data.nodes.push(ifNode);

// ---- 2. Rewire connections ----
const con = data.connections;

// Switch Rota[0] was → agente_agendador. Change it to → IF guard.
if (con["Switch Rota"]) {
  const mainOutputs = con["Switch Rota"].main || [];
  const idx0 = mainOutputs[0] || [];
  const agdEntry = idx0.findIndex((e) => e.node === "agente_agendador");
  if (agdEntry !== -1) {
    mainOutputs[0][agdEntry] = {
      node: GUARD_NAME,
      type: "main",
      index: 0,
    };
    console.log("✓ Switch Rota[0] rewired to IF guard.");
  } else {
    console.warn("agente_agendador not found in Switch Rota[0] — check manually.");
  }
}

// IF guard true (0) → agente_agendador
// IF guard false (1) → (nothing / dangling — n8n handles gracefully)
con[GUARD_NAME] = {
  main: [
    [
      {
        node: "agente_agendador",
        type: "main",
        index: 0,
      },
    ],
    // false branch: no connection (drops silently)
    [],
  ],
};
console.log("✓ IF guard connections created.");

// ---- 3. Save ----
fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log("✓ workflow-kCX2-live.json saved.");

// ---- 4. Push to n8n ----
const mcpPath = path.join(__dirname, "..", ".cursor", "mcp.json");
const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const workflowId = data.id;

console.log(`Pushing to n8n workflow ${workflowId}...`);

const getRes = await fetch(`${baseUrl}/workflows/${workflowId}`, {
  headers: { "X-N8N-API-KEY": apiKey },
});
if (!getRes.ok) {
  console.error("GET failed", getRes.status, await getRes.text());
  process.exit(1);
}
const current = await getRes.json();

const body = {
  name: data.name ?? current.name,
  nodes: data.nodes,
  connections: data.connections,
  settings: {
    executionOrder: current.settings?.executionOrder ?? "v1",
  },
  staticData: current.staticData ?? undefined,
};

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
console.log("✓ Workflow pushed to n8n:", putRes.status, text.slice(0, 200));
