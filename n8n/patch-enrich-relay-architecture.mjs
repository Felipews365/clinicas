// Patch: fix Enrich Agendador architecture — resolve timing paradox
//
// Problem: two runs of Enrich, neither has both context AND HTTP data:
//   Run 1 (IF → direct → Enrich): fires immediately, ctx has mensagem, but HTTP nodes not done
//   Run 2 (IF → HTTP Prof → HTTP Svcs → Enrich): HTTP data ready, but ctx has no mensagem
//   Guard 'if (!ctx.mensagem) return []' was blocking Run 2 (the useful one)
//
// Fix: insert two Code nodes in the HTTP chain to relay context through:
//   IF → HTTP Prof → [Enrich: Context Relay] → HTTP Svcs → [Enrich: Merge All] → Enrich
//
// Result: Enrich has ONE input (Enrich: Merge All), ONE execution, full data in $input.first().json.
// No more direct IF → Enrich connection, no more double-execution, no guard needed.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

// --- Node definitions ---

const RELAY_ID = 'enrich-relay-context';
const MERGE_ID = 'enrich-merge-all';
const RELAY_NAME = 'Enrich: Context Relay';
const MERGE_NAME = 'Enrich: Merge All';

const RELAY_CODE = `// Relay: capture context from IF mensagem válida (2 hops back, accessible)
// and attach it alongside HTTP Prof data so it survives the HTTP chain.
const ifCtx = $('IF mensagem v\xc3\xa3\xc2\xa1lida').first().json;
const httpProfData = $input.first().json;
return [{ json: { ...ifCtx, _httpProf: httpProfData } }];`;

const MERGE_CODE = `// Merge: combine context + prof data (from Relay, 2 hops back) with HTTP Svcs response.
const httpSvcsData = $input.first().json;
const relay = $('${RELAY_NAME}').first().json;
const { _httpProf, ...ctx } = relay;
return [{ json: { ...ctx, _httpProf, _httpSvcs: httpSvcsData } }];`;

const RELAY_NODE = {
  id: RELAY_ID,
  name: RELAY_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1575, -128],
  parameters: { jsCode: RELAY_CODE },
};

const MERGE_NODE = {
  id: MERGE_ID,
  name: MERGE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1930, -128],
  parameters: { jsCode: MERGE_CODE },
};

// New Enrich jsCode: reads everything from $input.first().json (no $() calls, no guard)
const NEW_ENRICH_CODE = `// Formata profissionais e serviços pré-buscados pelos HTTP nodes.
// $input.first().json contém: contexto completo (mensagem, clinic_id, ...) + _httpProf + _httpSvcs
// — injetados pelo Enrich: Context Relay + Enrich: Merge All.

const ctx = $input.first().json;

let profBlock = '';
let servicosBlock = '';

function extractSupabaseArray(raw) {
  if (Array.isArray(raw)) {
    if (raw.length > 0 && raw[0] && typeof raw[0] === 'object' && (raw[0].id || raw[0].nome)) return raw;
    if (raw.length > 0 && raw[0] && typeof raw[0] === 'object') {
      for (const v of Object.values(raw[0])) {
        if (Array.isArray(v) && v.length > 0) return v;
      }
    }
    return raw;
  }
  if (raw && typeof raw === 'object') {
    for (const v of Object.values(raw)) {
      if (Array.isArray(v)) return extractSupabaseArray(v);
      if (typeof v === 'string' && (v[0] === '[' || v[0] === '{')) {
        try {
          const p = JSON.parse(v);
          const r = extractSupabaseArray(p);
          if (r.length > 0 && r[0] && (r[0].id || r[0].nome)) return r;
        } catch(_) {}
      }
    }
  }
  if (typeof raw === 'string') {
    try { return extractSupabaseArray(JSON.parse(raw)); } catch(_) {}
  }
  return [];
}

function parseProfissionaisRpc(rawProf, allItems) {
  let profs = extractSupabaseArray(rawProf);
  if (!profs.length && allItems && allItems.length > 0) {
    const rows = allItems.map((i) => i.json).filter((r) => r && r.id && r.nome);
    if (rows.length === allItems.length) profs = rows;
    if (!profs.length) {
      for (const item of allItems) {
        const arr = extractSupabaseArray(item.json);
        if (arr.length > 0) { profs = arr; break; }
      }
    }
  }
  return Array.isArray(profs) ? profs : [];
}

function _normMsg(t) {
  return String(t || '').toLowerCase().replace(/\\s+/g, ' ').trim();
}

let svcsM = [];
try {
  svcsM = extractSupabaseArray(ctx._httpSvcs);
  if (!Array.isArray(svcsM)) svcsM = [];
} catch (_) {
  svcsM = [];
}

let procedimentoFromMsgBlock = '';
let procedimentoToolHint = null;
const um = _normMsg(ctx.mensagem);
if (svcsM.length && um.length >= 3) {
  const matches = [];
  for (const s of svcsM) {
    const nome = String(s.nome || '');
    const nn = _normMsg(nome);
    if (nn.length < 2) continue;
    if (um.includes(nn)) {
      matches.push(s);
      continue;
    }
    const parts = nn.split(/[^a-z0-9]+/).filter((p) => p.length >= 3);
    let hit = false;
    for (const p of parts) {
      if (um.includes(p)) {
        hit = true;
        break;
      }
    }
    if (hit) matches.push(s);
  }
  const seen = new Set();
  const uniq = [];
  for (const s of matches) {
    if (s && s.id && !seen.has(s.id)) {
      seen.add(s.id);
      uniq.push(s);
    }
  }
  if (uniq.length === 1) {
    const s = uniq[0];
    const nom = String(s.nome || '').replace(/\\*/g, '').replace(/["\\n\\r]/g, ' ').trim();
    procedimentoToolHint = { nome: nom, servico_id: String(s.id) };
    procedimentoFromMsgBlock =
      '\\n\\n## PEDIDO NA MENSAGEM ATUAL (obrigatório na tool de vagas)\\n' +
      'Detectamos menção ao serviço **' +
      nom +
      '**. Na **agd_cs_consultar_vagas** preencha **procedimento**="' +
      nom +
      '" ou **servico_id**=' +
      s.id +
      '.\\n' +
      'Se vier **[]** sem esses campos, **não** diga que não há horários — chame de novo com **procedimento** ou **servico_id**.\\n';
  } else if (uniq.length > 1) {
    procedimentoFromMsgBlock =
      '\\n\\n## PEDIDO NA MENSAGEM ATUAL\\n' +
      'A mensagem pode referir-se a: ' +
      uniq.map((x) => '**' + String(x.nome || '').replace(/\\*/g, '') + '** (\`' + x.id + '\`)').join(', ') +
      '. Use o nome/**servico_id** certo em **agd_cs_consultar_vagas**.\\n';
  }
}

let profs = [];
try {
  const rawProf = ctx._httpProf || {};
  const allP = rawProf && Object.keys(rawProf).length ? [{ json: rawProf }] : [];
  profs = parseProfissionaisRpc(rawProf, allP);
  if (Array.isArray(profs) && profs.length > 0) {
    let list = profs;
    let filtroHint = '';
    if (procedimentoToolHint && procedimentoToolHint.servico_id) {
      const hid = String(procedimentoToolHint.servico_id);
      const filtered = profs.filter(
        (p) =>
          Array.isArray(p.procedimento_ids) &&
          p.procedimento_ids.some((x) => String(x) === hid),
      );
      if (filtered.length > 0) {
        list = filtered;
        filtroHint =
          '\\n\\n**Lista filtrada:** só profissionais com o procedimento «' +
          (procedimentoToolHint.nome || hid) +
          '» no painel (servico_id ' +
          hid +
          '). **Ignore** outros nomes que possam existir noutros contextos.\\n';
      } else {
        filtroHint =
          '\\n\\n**Atenção:** nenhum profissional tem «' +
          (procedimentoToolHint.nome || 'este serviço') +
          '» vinculado no painel — use **agd_cs_profissionais_aptos_procedimento** ou corrija vínculos.\\n';
      }
    }
    const linhas = list
      .map((p) => {
        let procHint = ' | procedimentos: (painel sem vínculos — não oferecer para procedimento específico)';
        const pids = p.procedimento_ids;
        if (pids != null && Array.isArray(pids) && pids.length > 0) {
          procHint = ' | procedimentos (servico_id): ' + pids.join(', ');
        }
        return (
          '  - ' +
          (p.nome || '?') +
          (p.especialidade ? ' (' + p.especialidade + ')' : '') +
          procHint +
          ' | profissional_id: ' +
          p.id
        );
      })
      .join('\\n');
    const procRuleBlock =
      '\\n\\n## REGRA — PROCEDIMENTO PRIMEIRO, DEPOIS O PROFISSIONAL\\n' +
      '1) **Antes de horários ou profissional**, confirme qual **procedimento/serviço** o cliente quer: compare o que ele disse (ex.: clareamento) com **SERVIÇOS DISPONÍVEIS** e fixe o **servico_id** certo. ' +
      'Se não estiver claro, **pergunte** objetivamente qual procedimento deseja (pode citar 2–4 nomes do catálogo).\\n' +
      '2) «procedimentos (servico_id): …» = UUIDs cadastrados no painel; «painel sem vínculos» = **não** oferecer para procedimento específico (ex.: clareamento). ' +
      '3) Quando a mensagem **já citou** um serviço, a lista **PROFISSIONAIS** acima (se filtrada) contém **somente** quem realiza esse procedimento — **não** cite outros profissionais da clínica para esse serviço. ' +
      'Use **agd_cs_consultar_vagas** com **procedimento** ou **servico_id**.\\n' +
      '4) Se **só um** profissional for compatível, **não** pergunte preferência — vá direto às vagas dele.\\n' +
      '5) **agd_cs_consultar_vagas** / **agd_cs_agendar**: **procedimento** ou **servico_id** obrigatórios quando o serviço já for conhecido.\\n';
    profBlock =
      '\\n\\n## PROFISSIONAIS DISPONÍVEIS (use estes profissional_id — NÃO chame cs_consultar_profissionais):\\n' +
      linhas +
      filtroHint +
      procRuleBlock;
  }
} catch (e) {
  /* sem profissionais: agent usa tool normalmente */
}

try {
  if (svcsM.length > 0) {
    const linhas = svcsM
      .slice(0, 20)
      .map(
        (s) =>
          '  - ' +
          (s.nome || '?') +
          (s.preco_a_vista_brl ? ' | R$' + s.preco_a_vista_brl : '') +
          (s.duracao_minutos ? ' | ' + s.duracao_minutos + 'min' : '') +
          ' | servico_id: ' +
          s.id,
      )
      .join('\\n');
    servicosBlock =
      '\\n\\n## SERVIÇOS DISPONÍVEIS (use estes servico_id ao chamar cs_agendar — NÃO chame cs_consultar_servicos):\\n' +
      linhas;
  }
} catch (e) {
  /* sem serviços */
}

const catalogBridge =
  servicosBlock && profBlock
    ? '\\n\\n## LEITURA DO CATÁLOGO\\n' +
      'Primeiro identifique o **servico_id** em **SERVIÇOS DISPONÍVEIS** conforme o pedido do cliente. ' +
      'Depois, em **PROFISSIONAIS DISPONÍVEIS**, use só quem realiza esse serviço (ver regra abaixo na lista de profissionais).\\n'
    : '';

let mapaBlock = '';
try {
  if (svcsM.length > 0 && Array.isArray(profs) && profs.length > 0) {
    const linhasMapa = [];
    for (const s of svcsM) {
      if (!s.id || !s.nome) continue;
      const aptos = [];
      for (const p of profs) {
        const pids = Array.isArray(p.procedimento_ids) ? p.procedimento_ids.map(String) : [];
        if (pids.length > 0 && pids.includes(String(s.id))) {
          aptos.push(String(p.nome || '?'));
        }
      }
      if (aptos.length > 0) {
        linhasMapa.push('  - ' + s.nome + ' (servico_id: ' + s.id + '): ' + aptos.join(', '));
      }
    }
    if (linhasMapa.length > 0) {
      const ts = new Date().toLocaleTimeString('pt-BR', {timeZone:'America/Sao_Paulo'});
      mapaBlock = '\\n\\n## PROFISSIONAIS APTOS — DADOS AO VIVO [' + ts + ']\\n' +
        '🔴 GERADO AGORA DO BANCO — sobrepõe qualquer lista de profissionais do histórico de conversa.\\n' +
        'Profissional presente aqui mas ausente na memória = é NOVO, inclua nas opções.\\n' +
        'Profissional na memória mas ausente aqui = foi removido, não ofereça.\\n' +
        linhasMapa.join('\\n') + '\\n';
    }
  }
} catch (_mapaErr) { /* sem mapa */ }

return [
  {
    json: {
      ...ctx,
      agent_instructions:
        (ctx.agent_instructions || '') + catalogBridge + servicosBlock + profBlock + mapaBlock + procedimentoFromMsgBlock,
      _profissionais_pre_carregados: profBlock !== '',
      _servicos_pre_carregados: servicosBlock !== '',
      _procedimento_tool_hint: procedimentoToolHint,
    },
  },
];`;

// --- Apply patch to a nodes array ---
function patchNodes(nodes, connections) {
  const httpProfNode = nodes.find(n => n.name === 'HTTP Fetch Profissionais');
  const httpSvcsNode = nodes.find(n => n.name === 'HTTP Fetch Servicos');
  const enrichNode = nodes.find(n => n.id === 'enrich-agendador-prefetch');
  const ifNode = nodes.find(n => n.name.includes('mensagem v'));

  if (!httpProfNode || !httpSvcsNode || !enrichNode || !ifNode) {
    console.error('Required nodes not found!');
    return false;
  }

  // 1. Modify HTTP Fetch Servicos jsonBody to use $input instead of $('IF...')
  httpSvcsNode.parameters.jsonBody =
    '={{ JSON.stringify({ p_clinic_id: $input.first().json.clinic_id }) }}';
  console.log('Updated HTTP Fetch Servicos jsonBody');

  // 2. Replace existing Relay/Merge nodes if they exist, or add them
  const existingRelayIdx = nodes.findIndex(n => n.id === RELAY_ID);
  const existingMergeIdx = nodes.findIndex(n => n.id === MERGE_ID);

  if (existingRelayIdx >= 0) nodes.splice(existingRelayIdx, 1);
  if (existingMergeIdx >= 0) nodes.splice(existingMergeIdx, 1);

  nodes.push({ ...RELAY_NODE });
  nodes.push({ ...MERGE_NODE });
  console.log('Added Relay and Merge nodes');

  // 3. Update Enrich jsCode
  enrichNode.parameters.jsCode = NEW_ENRICH_CODE;
  console.log('Updated Enrich jsCode');

  // 4. Rewire connections
  // Remove: HTTP Prof → HTTP Svcs (replace with HTTP Prof → Relay)
  if (connections['HTTP Fetch Profissionais']) {
    connections['HTTP Fetch Profissionais'].main[0] = [
      { node: RELAY_NAME, type: 'main', index: 0 }
    ];
    console.log('Rewired HTTP Fetch Prof → Relay');
  }

  // Relay → HTTP Svcs
  connections[RELAY_NAME] = { main: [[{ node: 'HTTP Fetch Servicos', type: 'main', index: 0 }]] };
  console.log('Added Relay → HTTP Svcs');

  // Remove: HTTP Svcs → Enrich, replace with HTTP Svcs → Merge
  if (connections['HTTP Fetch Servicos']) {
    connections['HTTP Fetch Servicos'].main[0] = [
      { node: MERGE_NAME, type: 'main', index: 0 }
    ];
    console.log('Rewired HTTP Svcs → Merge');
  }

  // Merge → Enrich
  connections[MERGE_NAME] = { main: [[{ node: enrichNode.name, type: 'main', index: 0 }]] };
  console.log('Added Merge → Enrich');

  // Remove: IF → Enrich (direct) — keep IF → HTTP Prof
  const ifConns = connections[ifNode.name];
  if (ifConns && ifConns.main && ifConns.main[0]) {
    ifConns.main[0] = ifConns.main[0].filter(c => c.node !== enrichNode.name);
    console.log('Removed direct IF → Enrich connection');
  }

  return true;
}

// Apply to top-level nodes + connections
let ok = patchNodes(wf.nodes, wf.connections);
console.log('Top-level patch:', ok ? 'OK' : 'FAILED');

// Apply to activeVersion
if (wf.activeVersion && wf.activeVersion.nodes) {
  const avConns = wf.activeVersion.connections || wf.connections;
  if (!wf.activeVersion.connections) {
    // activeVersion shares connections with top-level — already patched
    console.log('activeVersion shares connections — skipping connection patch');
  }
  ok = patchNodes(wf.activeVersion.nodes, wf.activeVersion.connections || wf.connections);
  console.log('activeVersion patch:', ok ? 'OK' : 'FAILED');
}

writeFileSync(WF_PATH, JSON.stringify(wf, null, 2), 'utf8');
console.log('\nSaved', WF_PATH);
