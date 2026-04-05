/**
 * Patch: agente pergunta o nome do cliente no primeiro contato.
 *
 * O que faz:
 *   - Após "PG upsert chat_session", insere um bloco que:
 *       1. Verifica se o cliente já tem nome e se a sessão está em awaiting_name
 *       2. Se awaiting_name=true  → salva a msg atual como nome e continua
 *       3. Se nome vazio          → envia "Qual é o seu nome?" e para
 *       4. Se já tem nome         → continua normalmente
 *
 * Pré-requisito:
 *   Executar supabase/migrations/20260416120000_chat_sessions_awaiting_name.sql
 *
 * Uso:
 *   node n8n/patch-agent-ask-name.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpPath = path.join(__dirname, '..', '.cursor', 'mcp.json');
const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
const BASE = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const KEY = mcp.mcpServers.n8n.env.N8N_API_KEY;

const headers = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };

// ── 1. encontrar o workflow pelo nome ────────────────────────────────────────
const listRes = await fetch(`${BASE}/workflows?limit=100`, { headers });
if (!listRes.ok) { console.error('LIST falhou', listRes.status, await listRes.text()); process.exit(1); }
const { data: workflows } = await listRes.json();
const wf = workflows.find((w) => w.name.includes('Agente Atendimento Clínica'));
if (!wf) { console.error('Workflow "Agente Atendimento Clínica" não encontrado'); process.exit(1); }
console.log(`Workflow encontrado: "${wf.name}" (ID ${wf.id})`);

// ── 2. buscar workflow completo ──────────────────────────────────────────────
const getRes = await fetch(`${BASE}/workflows/${wf.id}`, { headers });
if (!getRes.ok) { console.error('GET falhou', getRes.status, await getRes.text()); process.exit(1); }
const workflow = await getRes.json();

// ── 3. novos nós ─────────────────────────────────────────────────────────────
const newNodes = [
  {
    id: 'agc-n01-pg-verify-name',
    name: 'PG verificar nome',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.5,
    position: [440, 160],
    parameters: {
      operation: 'executeQuery',
      query:
        "=SELECT COALESCE(TRIM(cc.name), '') AS client_name,\n" +
        "       COALESCE(cs.awaiting_name, false) AS awaiting_name\n" +
        "FROM chat_sessions cs\n" +
        "JOIN chat_clients cc ON cc.id = cs.client_id\n" +
        "WHERE cs.session_id = '{{ $('Anexar client_id').first().json.session_id }}'",
      options: {},
    },
    credentials: { postgres: { name: 'Supabase Postgres' } },
  },
  {
    id: 'agc-n02-gate-name',
    name: 'Gate nome',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [680, 160],
    parameters: {
      jsCode: [
        "const base = $('Anexar client_id').first().json;",
        "const row = $input.first().json;",
        "const name = (row.client_name || '').trim();",
        "const awaiting = row.awaiting_name === true;",
        "let state = 'continue';",
        "if (awaiting) state = 'save_name';",
        "else if (!name) state = 'ask_name';",
        "return [{ json: { ...base, client_name: name, awaiting_name: awaiting, name_state: state } }];",
      ].join('\n'),
    },
  },
  {
    id: 'agc-n03-switch-name',
    name: 'Switch nome',
    type: 'n8n-nodes-base.switch',
    typeVersion: 3,
    position: [920, 160],
    parameters: {
      rules: {
        values: [
          {
            conditions: {
              options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' },
              conditions: [{ id: 'sn1', leftValue: '={{ $json.name_state }}', rightValue: 'save_name', operator: { type: 'string', operation: 'equals' } }],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'salvar',
          },
          {
            conditions: {
              options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' },
              conditions: [{ id: 'sn2', leftValue: '={{ $json.name_state }}', rightValue: 'ask_name', operator: { type: 'string', operation: 'equals' } }],
              combinator: 'and',
            },
            renameOutput: true,
            outputKey: 'perguntar',
          },
        ],
      },
      options: { fallbackOutput: 'extra' },
    },
  },
  // ── ramo "salvar nome" ────────────────────────────────────────────────────
  {
    id: 'agc-n04-pg-save-name',
    name: 'PG salvar nome',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.5,
    position: [1160, -20],
    parameters: {
      operation: 'executeQuery',
      query:
        "=UPDATE chat_clients\n" +
        "SET name = left(TRIM('{{ String($json.message_content || '''').replace(/'/g, \"''\") }}'), 100)\n" +
        "WHERE phone = '{{ String($json.contact_phone || '''').replace(/'/g, \"''\") }}'",
      options: {},
    },
    credentials: { postgres: { name: 'Supabase Postgres' } },
  },
  {
    id: 'agc-n05-pg-clear-awaiting',
    name: 'PG clear awaiting nome',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.5,
    position: [1400, -20],
    parameters: {
      operation: 'executeQuery',
      query:
        "=UPDATE chat_sessions\n" +
        "SET awaiting_name = false, updated_at = now()\n" +
        "WHERE session_id = '{{ $('Gate nome').first().json.session_id }}'",
      options: {},
    },
    credentials: { postgres: { name: 'Supabase Postgres' } },
  },
  // ── ramo "perguntar nome" ─────────────────────────────────────────────────
  {
    id: 'agc-n06-evo-ask-name',
    name: 'EVO perguntar nome',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [1160, 340],
    parameters: {
      method: 'POST',
      url: "={{ ($env.EVOLUTION_API_BASE || '').replace(/\\/$/, '') + '/message/sendText/' + ($env.EVOLUTION_INSTANCE || '') }}",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ number: $json.session_id, text: "Olá! 😊 Para começar, pode me dizer o seu nome?", delay: 1000 }) }}',
      options: { response: { response: { neverError: true } } },
    },
  },
  {
    id: 'agc-n07-pg-set-awaiting',
    name: 'PG set awaiting nome',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.5,
    position: [1400, 340],
    parameters: {
      operation: 'executeQuery',
      query:
        "=UPDATE chat_sessions\n" +
        "SET awaiting_name = true, updated_at = now()\n" +
        "WHERE session_id = '{{ $('Gate nome').first().json.session_id }}'",
      options: {},
    },
    credentials: { postgres: { name: 'Supabase Postgres' } },
  },
  {
    id: 'agc-n08-noop-stop',
    name: 'Aguardando nome',
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position: [1640, 340],
    parameters: {},
  },
];

// ── 4. conexões a adicionar / substituir ─────────────────────────────────────
// Remove a ligação direta: PG upsert chat_session → PG histórico texto
// e substitui pelo novo fluxo de verificação de nome.

const newConnections = {
  // substituir: antes era PG upsert chat_session → PG histórico texto
  'PG upsert chat_session': { main: [[{ node: 'PG verificar nome', type: 'main', index: 0 }]] },

  'PG verificar nome': { main: [[{ node: 'Gate nome', type: 'main', index: 0 }]] },
  'Gate nome':         { main: [[{ node: 'Switch nome', type: 'main', index: 0 }]] },
  'Switch nome': {
    main: [
      [{ node: 'PG salvar nome',      type: 'main', index: 0 }], // output 0: salvar
      [{ node: 'EVO perguntar nome',  type: 'main', index: 0 }], // output 1: perguntar
      [{ node: 'PG histórico texto',  type: 'main', index: 0 }], // output 2: fallback (continuar)
    ],
  },

  // ramo salvar
  'PG salvar nome':         { main: [[{ node: 'PG clear awaiting nome', type: 'main', index: 0 }]] },
  'PG clear awaiting nome': { main: [[{ node: 'PG histórico texto',     type: 'main', index: 0 }]] },

  // ramo perguntar
  'EVO perguntar nome':  { main: [[{ node: 'PG set awaiting nome', type: 'main', index: 0 }]] },
  'PG set awaiting nome':{ main: [[{ node: 'Aguardando nome',       type: 'main', index: 0 }]] },
};

// ── 5. aplicar no workflow ────────────────────────────────────────────────────
// Remover nós com mesmos IDs se já existirem (re-run seguro)
const existingIds = new Set(newNodes.map((n) => n.id));
workflow.nodes = workflow.nodes.filter((n) => !existingIds.has(n.id));
workflow.nodes.push(...newNodes);

// Mesclar conexões
workflow.connections = { ...workflow.connections, ...newConnections };

// ── 6. push ───────────────────────────────────────────────────────────────────
const body = {
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: { executionOrder: workflow.settings?.executionOrder ?? 'v1' },
  staticData: workflow.staticData ?? undefined,
};

const putRes = await fetch(`${BASE}/workflows/${wf.id}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify(body),
});
const text = await putRes.text();
if (!putRes.ok) {
  console.error('PUT falhou', putRes.status, text.slice(0, 500));
  process.exit(1);
}
console.log('✅ Workflow atualizado com sucesso!');
console.log('Lembre-se de executar a migration SQL antes de testar:');
console.log('  supabase/migrations/20260416120000_chat_sessions_awaiting_name.sql');
