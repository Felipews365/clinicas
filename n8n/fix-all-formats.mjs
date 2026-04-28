import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json', 'utf8'));

// ─── 1. Fix clientFormatted in Code auto-notify ───────────────────────────────
for (const node of data.nodes) {
  if (node.type === 'n8n-nodes-base.code' && node.name?.toLowerCase().includes('auto-notify')) {
    let code = node.parameters.jsCode;

    // isCancel: user wants ✨ + "Seu atendimento foi cancelado com sucesso." + blank line + fields
    const cancelOld = `'Olá, ' + cn + '! Seu agendamento foi cancelado.',\n          '',\n          '🔴 Cancelamento',\n          '',\n          '📌 Serviço: ' + serv,`;
    const cancelNew = `'Olá, ' + cn + '! Seu agendamento foi cancelado ✨',\n          '',\n          'Seu atendimento foi cancelado com sucesso.',\n          '',\n          '📌 Serviço: ' + serv,`;
    if (code.includes(cancelOld)) {
      code = code.replace(cancelOld, cancelNew);
      console.log('✅ clientFormatted isCancel updated');
    } else { console.error('❌ cancelOld not found'); }

    // isCancel closing line
    const cancelClose1 = `'Se precisar remarcar, é só responder esta mensagem.',`;
    const cancelClose2 = `'Se quiser remarcar, é só responder esta mensagem.',`;
    // Only replace inside the isCancel block (before isResched)
    const cancelBlockIdx = code.indexOf("'Olá, ' + cn + '! Seu agendamento foi cancelado ✨'");
    if (cancelBlockIdx !== -1) {
      const nextReschedIdx = code.indexOf('isResched', cancelBlockIdx);
      const cancelBlock = code.substring(cancelBlockIdx, nextReschedIdx);
      if (cancelBlock.includes(cancelClose1)) {
        const before = code.substring(0, cancelBlockIdx);
        const inside = cancelBlock.replace(cancelClose1, cancelClose2);
        code = before + inside + code.substring(nextReschedIdx);
        console.log('✅ cancelamento closing message updated');
      }
    }

    // isResched: user wants ✨ + "Seu novo horário foi atualizado com sucesso." + blank + fields
    const reschedOld = `'Olá, ' + cn + '! Seu agendamento foi reagendado.',\n          '',\n          '🟡 Reagendamento',\n          '',\n          '📌 Serviço: ' + serv,`;
    const reschedNew = `'Olá, ' + cn + '! Seu agendamento foi reagendado ✨',\n          '',\n          'Seu novo horário foi atualizado com sucesso.',\n          '',\n          '📌 Serviço: ' + serv,`;
    if (code.includes(reschedOld)) {
      code = code.replace(reschedOld, reschedNew);
      console.log('✅ clientFormatted isResched updated');
    } else { console.error('❌ reschedOld not found'); }

    // novo: user wants ✨ + "Seu atendimento está reservado com sucesso." + blank + fields
    const novoOld = `'Olá, ' + cn + '! Seu agendamento está confirmado.',\n          '',\n          '🟢 Novo agendamento',\n          '',\n          '📌 Serviço: ' + serv,`;
    const novoNew = `'Olá, ' + cn + '! Seu agendamento foi confirmado ✨',\n          '',\n          'Seu atendimento está reservado com sucesso.',\n          '',\n          '📌 Serviço: ' + serv,`;
    if (code.includes(novoOld)) {
      code = code.replace(novoOld, novoNew);
      console.log('✅ clientFormatted novo updated');
    } else { console.error('❌ novoOld not found'); }

    node.parameters.jsCode = code;
    console.log('✅ Code node updated');
    break;
  }
}

// ─── 2. Update system message in root.nodes.113 (already mostly correct, align template) ─
// ─── 3. Update system message in root.activeVersion.nodes.113 (old format) ─────────────

const newMsgClientSection = `## MENSAGEM AO CLIENTE — APÓS TOOLS DE ESCRITA (obrigatório quando ok true)
⛔ **PROIBIDO** escrever texto livre. USE OBRIGATORIAMENTE os modelos abaixo, copiando a estrutura exata.
⛔ **PROIBIDO** usar asteriscos Markdown (*texto*), bullets • ou # no texto enviado ao cliente.
✅ Primeiro nome = primeira palavra de nome_cliente (se vazio, use "Cliente").
✅ Data sempre no formato dd/MM/aaaa.
✅ Profissional com Dr./Dra. conforme o gênero.

**MODELO — Novo agendamento (agd_cs_agendar ok:true):**
Olá, {PrimeiroNome}! Seu agendamento foi confirmado ✨

Seu atendimento está reservado com sucesso.

📌 Serviço: {servico}
👤 Profissional: {Dr_ou_Dra_nome}
📅 Data: {dd/MM/aaaa}
🕒 Horário: {HH:mm}

Se precisar de qualquer coisa, é só responder esta mensagem.

**MODELO — Reagendamento (agd_cs_reagendar ok:true):**
Olá, {PrimeiroNome}! Seu agendamento foi reagendado ✨

Seu novo horário foi atualizado com sucesso.

📌 Serviço: {servico}
👤 Profissional: {Dr_ou_Dra_nome}
📅 Nova data: {dd/MM/aaaa}
🕒 Novo horário: {HH:mm}

Se precisar de qualquer coisa, é só responder esta mensagem.

**MODELO — Cancelamento (agd_cs_cancelar ok:true):**
Olá, {PrimeiroNome}! Seu agendamento foi cancelado ✨

Seu atendimento foi cancelado com sucesso.

📌 Serviço: {servico}
👤 Profissional: {Dr_ou_Dra_nome}
📅 Data: {dd/MM/aaaa}
🕒 Horário: {HH:mm}

Se quiser remarcar, é só responder esta mensagem.`;

function updateSMInPath(obj, path) {
  if (!obj || typeof obj !== 'object') return 0;
  let count = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'systemMessage' && typeof v === 'string' && v.includes('MENSAGEM AO CLIENTE') && v.includes('agd_cs_agendar')) {
      const idx = v.indexOf('## MENSAGEM AO CLIENTE');
      const endMarker = '\n\n## FORMATAÇÃO (demais respostas)';
      const endIdx = v.indexOf(endMarker, idx);
      if (idx !== -1 && endIdx !== -1) {
        const before = v.substring(0, idx);
        const after = v.substring(endIdx);
        obj[k] = before + newMsgClientSection + after;
        count++;
        console.log(`✅ Updated SM at path ${path}.${k}`);
      }
    } else if (typeof v === 'object' && v !== null) {
      count += updateSMInPath(v, path + '.' + k);
    }
  }
  return count;
}

const updated = updateSMInPath(data, 'root');
console.log(`Total SM sections updated: ${updated}`);

writeFileSync('e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json', JSON.stringify(data, null, 2), 'utf8');
console.log('✅ File saved');
