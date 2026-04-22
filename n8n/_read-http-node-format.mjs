import fs from "fs";
const data = JSON.parse(fs.readFileSync("e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json", "utf8"));

// Find an existing httpRequest node to copy its format
const http = data.nodes.filter(n => n.type === "n8n-nodes-base.httpRequest");
console.log("HTTP Request nodes:", http.map(n => n.name));

// Show first one in detail
const h = http[0];
console.log("\nFull example node params:", JSON.stringify(h?.parameters, null, 2));
console.log("Node credentials:", JSON.stringify(h?.credentials));
console.log("Node typeVersion:", h?.typeVersion);

// Show agd_cs_buscar_agendamentos as example of toolHttpRequest with Supabase creds
const agd = data.nodes.find(n => n.name === "agd_cs_buscar_agendamentos");
console.log("\nagd_cs_buscar_agendamentos credentials:", JSON.stringify(agd?.credentials));
console.log("agd_cs_buscar_agendamentos params:", JSON.stringify(agd?.parameters, null, 2).substring(0,600));

// Positions of relevant nodes
const ifMens = data.nodes.find(n => n.name === "IF mensagem válida");
const agAgend = data.nodes.find(n => n.name === "agente_agendador");
console.log("\nIF mensagem válida position:", ifMens?.position);
console.log("agente_agendador position:", agAgend?.position);

// Connection from IF mensagem válida to agente_agendador
const ifConn = data.connections["IF mensagem válida"];
console.log("\nIF mensagem válida connections:", JSON.stringify(ifConn, null, 2));
