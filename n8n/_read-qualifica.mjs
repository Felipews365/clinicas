import fs from "fs";
const data = JSON.parse(fs.readFileSync("e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json", "utf8"));

// Find agente_atende_qualifica
const q = data.nodes.find(n => n.name === "agente_atende_qualifica");
console.log("=== agente_atende_qualifica ===");
console.log("type:", q?.type, "typeVersion:", q?.typeVersion);
console.log("params keys:", Object.keys(q?.parameters || {}));
console.log("promptType:", q?.parameters?.promptType);
console.log("text:", q?.parameters?.text);
console.log("options keys:", Object.keys(q?.parameters?.options || {}));
console.log("systemMessage:", String(q?.parameters?.options?.systemMessage || q?.parameters?.systemMessage || "").substring(0, 600));

// Check Memory qualifica
const memQ = data.nodes.find(n => n.name === "Memory qualifica");
console.log("\n=== Memory qualifica ===");
console.log("type:", memQ?.type, "params:", JSON.stringify(memQ?.parameters).substring(0, 200));

// Check Chat Model qualifica
const cmQ = data.nodes.find(n => n.name === "Chat Model qualifica");
console.log("\n=== Chat Model qualifica ===");
console.log("type:", cmQ?.type);
console.log("model:", JSON.stringify(cmQ?.parameters?.options?.modelName || cmQ?.parameters?.modelName || cmQ?.parameters?.model));

// Monta Contexto output fields
const mc = data.nodes.find(n => n.name === "Monta Contexto");
console.log("\n=== Monta Contexto return fields ===");
const match = mc?.parameters?.jsCode?.match(/return \[\{ json: \{([^}]+)\}/s);
if (match) console.log(match[0].substring(0, 400));

// agente_atende_qualifica feeds from what nodes?
const feedsQ = Object.entries(data.connections).filter(([,c]) => JSON.stringify(c).includes("agente_atende_qualifica"));
console.log("\n=== Nodes feeding agente_atende_qualifica ===");
feedsQ.forEach(([from]) => console.log(" ", from));
