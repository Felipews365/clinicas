import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcp = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".cursor", "mcp.json"), "utf8"));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, "");
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

// Check 65006 (error) AND 65005 (success) for comparison
for (const execId of [65006, 65005]) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`EXEC ${execId}`);
  const det = await fetch(`${baseUrl}/executions/${execId}?includeData=true`, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const d = await det.json();
  const runData = d.data?.resultData?.runData || {};

  // Print full agente_agendador run data (to find LLM output/tool calls)
  const agRuns = runData["agente_agendador"];
  if (agRuns) {
    agRuns.forEach((run, i) => {
      console.log(`\n--- agente_agendador run[${i}] ---`);
      if (run.error) {
        console.log("ERROR:", run.error.message?.substring(0, 200));
        console.log("STACK:", run.error.stack?.split('\n').slice(0,4).join('\n'));
      }
      // Print input data
      const inputData = run.inputData;
      if (inputData) {
        Object.entries(inputData).forEach(([key, val]) => {
          console.log(`INPUT[${key}]:`, JSON.stringify(val).substring(0, 300));
        });
      }
      // Print output data
      const outputMain = run?.data?.main?.[0]?.[0]?.json;
      if (outputMain) {
        console.log("OUTPUT:", JSON.stringify(outputMain).substring(0, 300));
      }
    });
  }

  // Chat Model agendador — has the raw LLM response with tool_calls
  const chatRuns = runData["Chat Model agendador"];
  if (chatRuns) {
    chatRuns.forEach((run, i) => {
      console.log(`\n--- Chat Model agendador run[${i}] ---`);
      const out = run?.data?.main?.[0]?.[0]?.json;
      if (out) console.log("OUTPUT:", JSON.stringify(out).substring(0, 500));
    });
  }

  // Memory agendador — stored conversation
  const memRuns = runData["Memory agendador"];
  if (memRuns) {
    memRuns.forEach((run, i) => {
      console.log(`\n--- Memory agendador run[${i}] ---`);
      const out = run?.data?.main?.[0]?.[0]?.json;
      if (out) console.log("OUTPUT:", JSON.stringify(out).substring(0, 400));
    });
  }

  // Also: Monta Contexto to get the full context being sent to agent
  const mcRun = runData["Monta Contexto"]?.[0]?.data?.main?.[0]?.[0]?.json;
  if (mcRun) {
    console.log(`\n--- Monta Contexto ---`);
    console.log("mensagem:", JSON.stringify(mcRun.mensagem));
    console.log("remoteJid:", mcRun.remoteJid);
    console.log("agent_instructions (last 200):", mcRun.agent_instructions?.slice(-200));
  }
}
