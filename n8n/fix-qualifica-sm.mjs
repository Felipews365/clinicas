import { readFileSync, writeFileSync } from 'fs';

const wf = JSON.parse(readFileSync('n8n/workflow-kCX2-live.json', 'utf8'));
const allNodes = [...(wf.nodes || [])];
if (wf.activeVersion && wf.activeVersion.nodes) allNodes.push(...wf.activeVersion.nodes);

// Character codes for "1ª" in double-encoded UTF-8
// Ã=195, ‚=8218(U+201A), Â=194, ª=170
const MARKER_1A = String.fromCharCode(195, 8218, 194, 170) + ' mensagem (novo)';

let totalFixed = 0;

allNodes.filter(n => n.name === 'agente_atende_qualifica').forEach((q, i) => {
  let sm = q.parameters?.options?.systemMessage || '';

  const markerIdx = sm.indexOf(MARKER_1A);
  if (markerIdx === -1) {
    console.log(`✗ qualifica node [${i}] - MARKER not found`);
    return;
  }

  // Find start of this bullet line (go back to find the bullet prefix \n...)
  // The bullet starts a few chars before markerIdx (after "▶ ")
  // Find the \n before this line
  let lineStart = sm.lastIndexOf('\n', markerIdx - 1);
  if (lineStart === -1) lineStart = 0;
  else lineStart += 1; // skip the \n itself

  // Find end of section: look for \n\n\n (triple newline) or \n\n##
  let sectionEnd = sm.indexOf('\n\n\n', markerIdx);
  if (sectionEnd === -1) {
    sectionEnd = sm.indexOf('\n\n##', markerIdx);
  }
  if (sectionEnd === -1) {
    console.log(`✗ qualifica node [${i}] - section end not found`);
    return;
  }

  const oldSection = sm.substring(lineStart, sectionEnd);
  console.log(`Node [${i}] old section:\n${oldSection}\n---`);

  // New section: strengthen greeting + add blocking rule
  // We preserve the bullet characters by reconstructing using the same double-encoded style
  // but add the new instructions in plain ASCII/UTF-8

  const newSection =
    oldSection
      // Add presentation requirement to 1st message bullet
      .replace(
        MARKER_1A + ': **n' + String.fromCharCode(195, 402, 194, 163) + 'o** pe' +
          String.fromCharCode(195, 402, 194, 167) + 'a nome',
        MARKER_1A + ': **n' + String.fromCharCode(195, 402, 194, 163) + 'o** pe' +
          String.fromCharCode(195, 402, 194, 167) + 'a nome'
      ) +
      '\n\n⛔ BLOQUEIO NOME: Se nome_cliente vazio E nao e o 1o contato (primeiro_contato=false) → OBRIGATORIO perguntar "Qual e o seu nome e sobrenome?" + [ROTA: concluido]. SO apos cs_salvar_nome confirmar pode encaminhar para agendador ou outro agente.';

  // Also update the "como ajudar" bullet to add presentation requirement
  const fullReplacement = newSection.replace(
    /sÃƒÂ³ como ajudar\./,
    'sÃƒÂ³ como ajudar. SEMPRE inclua na saudacao: "Sou {nome_agente}, da {clinic_name}." (obrigatorio mesmo que saudacao_novo nao inclua o nome do agente).'
  );

  q.parameters.options.systemMessage = sm.substring(0, lineStart) + fullReplacement + sm.substring(sectionEnd);
  totalFixed++;
  console.log(`✓ Fixed qualifica node [${i}]`);
});

console.log(`\nTotal fixed: ${totalFixed}`);

if (totalFixed > 0) {
  writeFileSync('n8n/workflow-kCX2-live.json', JSON.stringify(wf, null, 2));
  console.log('✓ Saved workflow-kCX2-live.json');
}
