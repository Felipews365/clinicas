import fs from "fs";
const data = JSON.parse(fs.readFileSync("e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json", "utf8"));

// Monta Contexto
const mc = data.nodes.find(n => n.name === "Monta Contexto");
console.log("=== Monta Contexto jsCode ===");
console.log(mc?.parameters?.jsCode);

// agente_agendador system message
const ag = data.nodes.find(n => n.name === "agente_agendador");
console.log("\n=== agente_agendador systemMessage ===");
console.log(String(ag?.parameters?.systemMessage || "").substring(0, 800));

// Connections TO agente_agendador (what feeds into it)
const toAgend = Object.entries(data.connections).filter(([, conns]) =>
  JSON.stringify(conns).includes("agente_agendador")
);
console.log("\n=== Nodes feeding into agente_agendador ===");
toAgend.forEach(([from]) => console.log(" ", from));

// agd_ tools and their placeholder counts
const agdTools = data.nodes.filter(n =>
  n.type === "@n8n/n8n-nodes-langchain.toolHttpRequest" && n.name.startsWith("agd_")
);
console.log("\n=== agd_ tools ===");
agdTools.forEach(n => {
  const ph = n.parameters?.placeholderDefinitions?.values || [];
  console.log(`  ${n.name}: method=${n.parameters?.method}, placeholders=[${ph.map(p => p.name).join(",")}]`);
  console.log(`    url tail: ${String(n.parameters?.url || "").slice(-60)}`);
});

// Code merge webhook credentials
const creds = data.nodes.filter(n => n.type === "n8n-nodes-base.httpRequest" && n.name.includes("RPC"));
console.log("\n=== HTTP RPC nodes ===");
creds.forEach(n => {
  console.log(`  ${n.name}: url=${String(n.parameters?.url || "").substring(0, 100)}`);
  console.log(`    creds: ${JSON.stringify(n.credentials)}`);
});
