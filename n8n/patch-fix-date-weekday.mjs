/**
 * Fix: agente qualificador calculando dia da semana errado.
 *
 * Problema: system message tinha "dd/MM/yyyy HH:mm" mas NÃO o dia da semana.
 * gpt-4o-mini não sabe que 21/04/2026 é terça-feira, então calculou "quarta-feira"
 * como 26 de abril (domingo!) em vez de 22 de abril.
 *
 * Fix:
 *  1. Adiciona dia da semana em português na system message do qualificador e do agendador
 *  2. Adiciona instrução para NUNCA confirmar data sem verificar a ISO
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");
const data = JSON.parse(fs.readFileSync(wfPath, "utf8"));

// n8n expression: Luxon weekday 1=Mon...7=Sun → nome em português
const WEEKDAY_EXPR = `={{ ['','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado','domingo'][$now.weekday] }}`;

// Full date line para inserir no início das system messages
const DATE_LINE_SM = `Data/hora: {{ $now.format('dd/MM/yyyy HH:mm') }} — Hoje é {{ ['','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado','domingo'][$now.weekday] }} — YYYY-MM-DD: {{ $now.format('yyyy-MM-dd') }}`;

// Instrução sobre datas
const DATE_INSTR = `\n\nREGRA DATAS: Quando o cliente mencionar datas relativas ("quarta-feira", "amanhã", "semana que vem", etc.), converta SEMPRE para YYYY-MM-DD antes de confirmar qualquer data. Use o dia da semana atual acima para calcular. NUNCA confirme uma data sem checar que o dia da semana bate.`;

// ── 1. Fix agente_atende_qualifica system message ──
const qNode = data.nodes.find(n => n.name === "agente_atende_qualifica");
if (qNode?.parameters?.options?.systemMessage) {
  let sm = qNode.parameters.options.systemMessage;
  
  // Replace the old Data/hora line with the enhanced one
  const OLD_DATE = `Data/hora: {{ $now.format('dd/MM/yyyy HH:mm') }}`;
  if (sm.includes(OLD_DATE)) {
    sm = sm.replace(OLD_DATE, DATE_LINE_SM);
    console.log("✓ qualifica: replaced Data/hora line with weekday-aware version");
  } else if (!sm.includes("segunda-feira")) {
    // No date line at all — prepend
    sm = sm.replace(/^(=)/, `=${ DATE_LINE_SM }\n`);
    console.log("✓ qualifica: prepended date line");
  } else {
    console.log("✓ qualifica: already has weekday info");
  }
  
  // Add date rule instruction if not already present
  if (!sm.includes("REGRA DATAS")) {
    // Insert after the header section (find end of first paragraph)
    const insertIdx = sm.indexOf("##", 50); // after opening line
    if (insertIdx > 0) {
      sm = sm.slice(0, insertIdx) + DATE_INSTR + "\n\n" + sm.slice(insertIdx);
    } else {
      sm = sm + DATE_INSTR;
    }
    console.log("✓ qualifica: added REGRA DATAS instruction");
  }
  
  qNode.parameters.options.systemMessage = sm;
} else {
  console.log("⚠ qualifica: systemMessage not found in expected location");
}

// ── 2. Fix agente_agendador system message (in options.systemMessage) ──
const agNode = data.nodes.find(n => n.name === "agente_agendador");
if (agNode?.parameters?.options?.systemMessage) {
  let sm = agNode.parameters.options.systemMessage;
  
  // The agendador already has "yyyy-MM-dd" but might not have weekday
  const OLD_AG = `Data/hora atual: {{ $now.format('dd/MM/yyyy HH:mm') }} — em YYYY-MM-DD: {{ $now.format('yyyy-MM-dd') }}`;
  const NEW_AG = `Data/hora atual: {{ $now.format('dd/MM/yyyy HH:mm') }} — Hoje é {{ ['','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado','domingo'][$now.weekday] }} — YYYY-MM-DD: {{ $now.format('yyyy-MM-dd') }}`;
  
  if (sm.includes(OLD_AG)) {
    sm = sm.replace(OLD_AG, NEW_AG);
    console.log("✓ agendador: replaced date line with weekday-aware version");
  } else if (sm.includes(NEW_AG)) {
    console.log("✓ agendador: already has weekday-aware date line");
  } else {
    console.log("⚠ agendador: could not find expected date line — showing first 200 chars:");
    console.log(sm.substring(0, 200));
  }
  
  agNode.parameters.options.systemMessage = sm;
}

// ── Save ──
fs.writeFileSync(wfPath, JSON.stringify(data, null, 2), "utf8");
console.log("\n✓ workflow-kCX2-live.json saved.");

// ── Verify ──
const qSM = data.nodes.find(n => n.name === "agente_atende_qualifica")?.parameters?.options?.systemMessage || "";
const agSM = data.nodes.find(n => n.name === "agente_agendador")?.parameters?.options?.systemMessage || "";
console.log("\nQualifica SM contains weekday expr:", qSM.includes("segunda-feira"));
console.log("Qualifica SM contains REGRA DATAS:", qSM.includes("REGRA DATAS"));
console.log("Agendador SM contains weekday expr:", agSM.includes("segunda-feira"));
console.log("\nQualifica date line:", qSM.match(/Data\/hora:[^\n]*/)?.[0]);
console.log("Agendador date line:", agSM.match(/Data\/hora atual:[^\n]*/)?.[0]);

// ── Push ──
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;
const workflowId = data.id;

const getRes = await fetch(`${baseUrl}/workflows/${workflowId}`, { headers: { "X-N8N-API-KEY": apiKey } });
if (!getRes.ok) { console.error("GET failed"); process.exit(1); }
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
if (!putRes.ok) { console.error("PUT failed", text.substring(0, 200)); process.exit(1); }
console.log("\n✓ Pushed to n8n:", putRes.status, text.slice(0, 100));
