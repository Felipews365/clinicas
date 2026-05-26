// Patch: rewrite Enrich Agendador jsCode fixing 3 bugs:
// 1. extractSupabaseArray() handles {"fn_name": [...]} Supabase RPC response format
// 2. profs declared OUTSIDE try block (was block-scoped, inaccessible to mapaBlock)
// 3. svcsM and parseProfissionaisRpc use extractSupabaseArray()

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');

const NEW_JSCODE = `// Formata profissionais e serviços pré-buscados pelos HTTP nodes anteriores.
// HTTP Fetch Profissionais → POST rpc/n8n_cs_profissionais_para_agente (jsonb array) ou texto.

const ctx = $('IF mensagem válida').first().json;

let profBlock = '';
let servicosBlock = '';

// Extrai array de resposta Supabase RPC (RETURNS jsonb devolve {"fn_name": value} por linha)
function extractSupabaseArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const vals = Object.values(raw);
    for (const v of vals) {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') {
        try { const p = JSON.parse(v); if (Array.isArray(p)) return p; } catch(_) {}
      }
    }
  }
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch(_) {}
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
  const rawSvcM = $('HTTP Fetch Servicos').first().json;
  svcsM = extractSupabaseArray(rawSvcM);
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

// IMPORTANTE: profs declarado FORA do try para ser acessível no mapaBlock abaixo
let profs = [];
try {
  const allP = $('HTTP Fetch Profissionais').all();
  const rawProf = allP[0] ? allP[0].json : {};
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


// Mapa procedimento → profissionais aptos (calculado a partir dos dados já carregados)
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
} catch (_mapaErr) { /* sem mapa – agent usa regras do SM */ }
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

const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

let patchedNodes = 0;
for (const arr of [wf.nodes, wf.activeVersion?.nodes].filter(Boolean)) {
  const node = arr.find((n) => n.id === 'enrich-agendador-prefetch');
  if (node) {
    node.parameters.jsCode = NEW_JSCODE;
    patchedNodes++;
  }
}

if (patchedNodes === 0) {
  console.error('ERROR: node enrich-agendador-prefetch not found!');
  process.exit(1);
}

writeFileSync(WF_PATH, JSON.stringify(wf, null, 2), 'utf8');
console.log(`Patched ${patchedNodes} occurrence(s) of enrich-agendador-prefetch`);
console.log('New jsCode length:', NEW_JSCODE.length);
