// Patch: log per-clinic AI usage to Supabase (ai_usage_logs).
// Adds, for each of the 4 text agents in the main flow, a PARALLEL branch:
//   <agent> -> "Log AI Usage <agent>" (Code) -> "HTTP Log AI Usage <agent>" (Supabase RPC)
// The original wiring (agent -> next) stays intact — logging is best-effort
// and never blocks the WhatsApp reply.
//
// The Code node tries multiple paths for tokenUsage (n8n LangChain shape varies
// between versions) and falls back to a char-based estimate so something is
// always logged. Cost is computed with gpt-4o-mini prices.
//
// Run:  node n8n/patch-ai-usage-logging.mjs
// Then: node n8n/push-workflow-api.mjs kCX2LfxJrdYWB0vk n8n/workflow-kCX2-live.json --activate

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

const SUPABASE_URL = 'https://xkwdwioawosthwjqijfb.supabase.co';
const SUPABASE_CRED = { id: 'SmHWpBnyL1cYuhlm', name: 'Supabase clinicas' };

const AGENTS = [
  { agent: 'agente_atende_qualifica',           llm: 'Chat Model qualifica',   tag: 'qualificador' },
  { agent: 'agente_agendador',                  llm: 'Chat Model agendador',   tag: 'agendador' },
  { agent: 'agente_faq',                        llm: 'Chat Model faq',         tag: 'faq' },
  { agent: 'agente_especialista_procedimentos', llm: 'Chat Model especialista',tag: 'especialista' },
];

function codeNodeJs(tag, llmName) {
  // gpt-4o-mini pricing as of 2026-01:
  //   input  $0.150 / 1M tokens
  //   output $0.600 / 1M tokens
  return [
    "// Log AI Usage — extrai tokenUsage do LLM upstream e calcula custo USD.",
    "// Falha em logar nunca pode derrubar a resposta — try/catch tudo.",
    "const PRICE_PER_M_IN  = 0.150;",
    "const PRICE_PER_M_OUT = 0.600;",
    "",
    "function pickTokens(srcAll) {",
    "  for (const it of srcAll) {",
    "    const j = it.json || {};",
    "    // n8n langchain shapes seen across versions:",
    "    const candidates = [",
    "      j.tokenUsage,",
    "      j.usage,",
    "      j.response && j.response.llmOutput && j.response.llmOutput.tokenUsage,",
    "      j.response && j.response.usage,",
    "      j.response && j.response.generations && j.response.generations[0]",
    "        && j.response.generations[0][0] && j.response.generations[0][0].generationInfo",
    "        && j.response.generations[0][0].generationInfo.tokenUsage,",
    "    ];",
    "    for (const c of candidates) {",
    "      if (!c) continue;",
    "      const p = Number(c.promptTokens ?? c.prompt_tokens ?? c.input_tokens ?? 0) || 0;",
    "      const o = Number(c.completionTokens ?? c.completion_tokens ?? c.output_tokens ?? 0) || 0;",
    "      if (p + o > 0) return { p, o };",
    "    }",
    "  }",
    "  return null;",
    "}",
    "",
    "let clinic_id = null;",
    "let p = 0, o = 0, source = 'unknown';",
    "try {",
    "  clinic_id = $('Monta Contexto').first().json.clinic_id || null;",
    "} catch (_) {}",
    "",
    "try {",
    `  const llmAll = $('${llmName}').all();`,
    "  const picked = pickTokens(llmAll);",
    "  if (picked) { p = picked.p; o = picked.o; source = 'llm_usage'; }",
    "} catch (_) {}",
    "",
    "if (p + o === 0) {",
    "  // Fallback heuristic: ~4 chars/token. Não é exato, mas dá ordem de grandeza.",
    "  try {",
    "    const ctx = ($('Monta Contexto').first().json || {});",
    "    const inputChars = String(ctx.mensagem || '').length + String(ctx.agent_instructions || '').length;",
    "    const out = String($json.output || $json.text || '');",
    "    p = Math.ceil(inputChars / 4);",
    "    o = Math.ceil(out.length / 4);",
    "    source = 'char_estimate';",
    "  } catch (_) {}",
    "}",
    "",
    "const cost_usd = (p / 1e6) * PRICE_PER_M_IN + (o / 1e6) * PRICE_PER_M_OUT;",
    "",
    "return [{ json: {",
    "  ...$json,",
    "  _ai_usage: {",
    "    clinic_id,",
    `    agent: '${tag}',`,
    "    model: 'gpt-4o-mini',",
    "    prompt_tokens: p,",
    "    completion_tokens: o,",
    "    cost_usd,",
    "    source,",
    "  }",
    "} }];",
  ].join('\n');
}

function patch(nodes, connections) {
  let changed = false;

  for (const { agent, llm, tag } of AGENTS) {
    const codeName = `Log AI Usage ${tag}`;
    const httpName = `HTTP Log AI Usage ${tag}`;

    if (nodes.find((n) => n.name === codeName)) {
      console.log(`[${tag}] already patched`);
      continue;
    }

    const agentNode = nodes.find((n) => n.name === agent);
    if (!agentNode) {
      console.log(`[${tag}] agent node not found, skipping`);
      continue;
    }

    const [ax, ay] = agentNode.position;
    const codeNode = {
      id: `log-ai-usage-${tag}`,
      name: codeName,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [ax + 200, ay + 280],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: codeNodeJs(tag, llm),
      },
      onError: 'continueRegularOutput',
    };

    const httpNode = {
      id: `http-log-ai-usage-${tag}`,
      name: httpName,
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [ax + 420, ay + 280],
      parameters: {
        method: 'POST',
        url: `={{ '${SUPABASE_URL}'.replace(/\\/+$/, '') + '/rest/v1/rpc/n8n_ai_usage_log' }}`,
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'supabaseApi',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Prefer', value: 'return=minimal' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: [
          '={{ JSON.stringify({',
          '  p_clinic_id: $json._ai_usage.clinic_id,',
          '  p_agent: $json._ai_usage.agent,',
          '  p_model: $json._ai_usage.model,',
          '  p_prompt_tokens: $json._ai_usage.prompt_tokens,',
          '  p_completion_tokens: $json._ai_usage.completion_tokens,',
          '  p_cost_usd: $json._ai_usage.cost_usd,',
          '}) }}',
        ].join('\n'),
        options: {},
      },
      credentials: { supabaseApi: SUPABASE_CRED },
      onError: 'continueRegularOutput',
    };

    nodes.push(codeNode, httpNode);

    // Parallel branch: keep existing connections, just APPEND a new entry to main[0].
    if (!connections[agent]) connections[agent] = { main: [[]] };
    if (!connections[agent].main) connections[agent].main = [[]];
    if (!connections[agent].main[0]) connections[agent].main[0] = [];
    connections[agent].main[0].push({ node: codeName, type: 'main', index: 0 });

    connections[codeName] = {
      main: [[{ node: httpName, type: 'main', index: 0 }]],
    };

    changed = true;
    console.log(`[${tag}] added Code + HTTP nodes and parallel branch`);
  }

  return changed;
}

let changed = false;
changed = patch(wf.nodes, wf.connections) || changed;
if (wf.activeVersion?.nodes) {
  changed = patch(wf.activeVersion.nodes, wf.activeVersion.connections || wf.connections) || changed;
}

if (changed) {
  writeFileSync(WF_PATH, JSON.stringify(wf, null, 2), 'utf8');
  console.log('Saved workflow with AI usage logging.');
} else {
  console.log('No changes made.');
}
