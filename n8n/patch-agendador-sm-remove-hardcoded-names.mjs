// Patch: remove hardcoded professional names from agendador SM examples.
//
// Root cause (2026-05-27): SM had two examples using "Dr. Herick" + "Dra. Maria Leticia"
// as canonical answer for Limpeza. The LLM (temp 0.1) copied these verbatim and ignored
// the actual MAPA, omitting "jose" (3rd professional with Limpeza).
//
// Fix: replace concrete names with placeholders that make it explicit the LLM must
// use the MAPA, not the example.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WF_PATH = resolve('n8n/workflow-kCX2-live.json');
const wf = JSON.parse(readFileSync(WF_PATH, 'utf8'));

const REPLACEMENTS = [
  {
    from: 'Correto: "Para Limpeza: Dr. Herick ou Dra. Maria Leticia. Com qual prefere?"',
    to: 'Correto (formato): "Para {procedimento}: {Profissional A}, {Profissional B}, {Profissional C}. Com qual prefere?" — substitua TODOS os nomes pelos do MAPA acima, sem omissões, sem ordenação alfabética, sem filtro por estilo de nome.',
  },
  {
    from: 'Exemplo CORRETO: "Com qual prefere?\n  Dr. Herick\n  Dra. Maria Letícia"',
    to: 'Exemplo CORRETO (formato): "Com qual prefere?\n  {Profissional A}\n  {Profissional B}\n  {Profissional C}" — liste TODOS os profissionais do MAPA APTOS para o procedimento, mesmo com nomes em minúsculas, sem prefixo Dr./Dra., ou sem especialidade. NUNCA omita nomes.',
  },
];

function patchSM(nodes) {
  const agendador = nodes.find(n => n.id === 'ma-agent-agendador');
  if (!agendador) return false;
  let sm = agendador.parameters?.options?.systemMessage;
  if (!sm) return false;

  let changed = 0;
  for (const { from, to } of REPLACEMENTS) {
    if (sm.includes(from)) {
      sm = sm.replace(from, to);
      changed++;
      console.log('Replaced:', from.substring(0, 60) + '...');
    } else {
      console.log('NOT FOUND (already patched?):', from.substring(0, 60) + '...');
    }
  }

  // Also add a strong rule at the top of MAPA section to forbid omissions
  const mapaRuleAddition = '\n\n## REGRA OBRIGATÓRIA — LISTAGEM COMPLETA\nQuando listar profissionais para o cliente: use TODOS os nomes do MAPA APTOS para o procedimento solicitado. Nunca omita nenhum. Nomes em minúsculas, sem prefixo (Dr./Dra.), ou sem especialidade são igualmente válidos — todos representam profissionais reais cadastrados. Listar apenas alguns é um erro crítico.';

  if (!sm.includes('LISTAGEM COMPLETA')) {
    // Insert after the first occurrence of "PROCEDIMENTO → PROFISSIONAL → HORÁRIO"
    const anchor = '## PROCEDIMENTO → PROFISSIONAL → HORÁRIO';
    if (sm.includes(anchor)) {
      sm = sm.replace(anchor, anchor + mapaRuleAddition + '\n\n' + anchor.replace('## ', '## '));
      // The above doubles the header — fix it:
      sm = sm.replace(
        '## PROCEDIMENTO → PROFISSIONAL → HORÁRIO' + mapaRuleAddition + '\n\n## PROCEDIMENTO → PROFISSIONAL → HORÁRIO',
        mapaRuleAddition.trim() + '\n\n## PROCEDIMENTO → PROFISSIONAL → HORÁRIO'
      );
      changed++;
      console.log('Added LISTAGEM COMPLETA rule');
    }
  }

  agendador.parameters.options.systemMessage = sm;
  return changed > 0;
}

let okTop = patchSM(wf.nodes);
console.log('nodes[] patched:', okTop);
let okActive = wf.activeVersion?.nodes ? patchSM(wf.activeVersion.nodes) : null;
console.log('activeVersion.nodes[] patched:', okActive);

writeFileSync(WF_PATH, JSON.stringify(wf, null, 2), 'utf8');
console.log('Saved');
