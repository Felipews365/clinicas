import { readFileSync, writeFileSync } from 'fs';

const wf = JSON.parse(readFileSync('n8n/workflow-kCX2-live.json', 'utf8'));
const allNodes = [...(wf.nodes || [])];
if (wf.activeVersion && wf.activeVersion.nodes) allNodes.push(...wf.activeVersion.nodes);

// ============================================================
// FIX 1: Qualificador - reforçar saudação + bloqueio de nome
// ============================================================
const OLD_BULLETS =
  "Ã¢â€ºâ€ 1Ã‚Âª mensagem (novo): **nÃƒÂ£o** peÃƒÂ§a nome Ã¢â‚¬â€ sÃƒÂ³ como ajudar.\n" +
  "Ã¢â€ºâ€ Depois, se nome vazio: peÃƒÂ§a **nome e sobrenome** Ã¢â€ â€™ **cs_salvar_nome** uma vez com o nome completo.\n" +
  "Ã¢â€ºâ€ Se nome_cliente jÃƒÂ¡ estÃƒÂ¡ preenchido Ã¢â€ â€™ nÃƒÂ£o pergunte de novo.";

const NEW_BULLETS =
  "Ã¢â€ºâ€ 1Ã‚Âª mensagem (novo): **nÃƒÂ£o** peÃƒÂ§a nome Ã¢â‚¬â€ sÃƒÂ³ como ajudar. SEMPRE inclua na saudacao: \"Sou {nome_agente}, da {clinic_name}.\" (obrigatorio mesmo que saudacao_novo nao inclua o nome do agente).\n" +
  "Ã¢â€ºâ€ Depois, se nome vazio: peÃƒÂ§a **nome e sobrenome** Ã¢â€ â€™ **cs_salvar_nome** uma vez com o nome completo.\n" +
  "Ã¢â€ºâ€ Se nome_cliente jÃƒÂ¡ estÃƒÂ¡ preenchido Ã¢â€ â€™ nÃƒÂ£o pergunte de novo.\n\n" +
  "⛔ BLOQUEIO NOME: Se nome_cliente vazio E nao e o 1o contato (primeiro_contato=false) → OBRIGATORIO perguntar \"Qual e o seu nome e sobrenome?\" com [ROTA: concluido]. SO apos cs_salvar_nome confirmar pode encaminhar para agendador ou outro agente.";

let totalFixed = 0;

allNodes.filter(n => n.name === 'agente_atende_qualifica').forEach((q, i) => {
  const sm = q.parameters?.options?.systemMessage || '';
  if (sm.includes(OLD_BULLETS)) {
    q.parameters.options.systemMessage = sm.replace(OLD_BULLETS, NEW_BULLETS);
    totalFixed++;
    console.log(`✓ Fixed qualifica node [${i}]`);
  } else {
    console.log(`✗ qualifica node [${i}] - OLD_BULLETS not found (sm length: ${sm.length})`);
  }
});

// ============================================================
// FIX 2: Agendador - novos modelos de confirmação
// ============================================================
const OLD_HEADER = '## MENSAGEM AO CLIENTE';

// Build old and new models by finding the exact section
allNodes.filter(n => n.name === 'agente_agendador').forEach((ag, i) => {
  let sm = ag.parameters?.options?.systemMessage || '';

  const sectionStart = sm.indexOf('## MENSAGEM AO CLIENTE');
  const sectionEnd = sm.indexOf('\n## FORMATAC');  // next section

  if (sectionStart === -1) {
    console.log(`✗ agendador node [${i}] - MENSAGEM AO CLIENTE not found`);
    return;
  }

  const endMark = sectionEnd !== -1 ? sectionEnd : sm.indexOf('\n## VAGAS');
  if (endMark === -1) {
    console.log(`✗ agendador node [${i}] - end of section not found`);
    return;
  }

  const oldSection = sm.substring(sectionStart, endMark);

  // New section with better confirmation templates
  const newSection =
    "## MENSAGEM AO CLIENTE — APÓS TOOLS DE ESCRITA (obrigatório quando ok true)\n" +
    "▶ **PROIBIDO** escrever texto livre. USE OBRIGATORIAMENTE os modelos abaixo.\n" +
    "▶ **PROIBIDO** usar asteriscos Markdown (*texto*), bullets ou # no texto enviado ao cliente.\n" +
    "✅ Data por extenso: ex. \"05 de maio de 2026\". Adicione \" (amanhã)\" se for o dia seguinte, \" (hoje)\" se for hoje.\n" +
    "✅ Horário: use \"14h\" se minutos=00; \"14h30\" se minutos != 00.\n" +
    "✅ Profissional com Dr./Dra. conforme o gênero.\n\n" +
    "**MODELO — Novo agendamento (agd_cs_agendar ok:true):**\n" +
    "O seu agendamento para {servico} está confirmado ✅\n" +
    "📅 Data: {dia de mês-por-extenso de ano} (amanhã/hoje se aplicável)\n" +
    "⏰ Horário: {HH}h{minutos se != 00}\n" +
    "👨‍⚕️ Profissional: {Dr_ou_Dra_nome}\n\n" +
    "Qualquer dúvida ou necessidade, estou à disposição! 😊\n\n" +
    "**MODELO — Reagendamento (agd_cs_reagendar ok:true):**\n" +
    "O seu agendamento para {servico} foi reagendado ✅\n" +
    "📅 Nova data: {dia de mês-por-extenso de ano} (amanhã/hoje se aplicável)\n" +
    "⏰ Novo horário: {HH}h{minutos se != 00}\n" +
    "👨‍⚕️ Profissional: {Dr_ou_Dra_nome}\n\n" +
    "Qualquer dúvida ou necessidade, estou à disposição! 😊\n\n" +
    "**MODELO — Cancelamento (agd_cs_cancelar ok:true):**\n" +
    "O seu agendamento para {servico} foi cancelado.\n" +
    "📅 Data: {dia de mês-por-extenso de ano}\n" +
    "⏰ Horário: {HH}h{minutos se != 00}\n" +
    "👨‍⚕️ Profissional: {Dr_ou_Dra_nome}\n\n" +
    "Se quiser remarcar, é só responder esta mensagem. 😊";

  ag.parameters.options.systemMessage = sm.substring(0, sectionStart) + newSection + sm.substring(endMark);
  totalFixed++;
  console.log(`✓ Fixed agendador node [${i}] (replaced ${oldSection.length} chars → ${newSection.length} chars)`);
});

console.log(`\nTotal fixed: ${totalFixed}`);

if (totalFixed > 0) {
  writeFileSync('n8n/workflow-kCX2-live.json', JSON.stringify(wf, null, 2));
  console.log('✓ Saved workflow-kCX2-live.json');
}
