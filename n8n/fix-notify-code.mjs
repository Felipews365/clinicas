import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json', 'utf8'));

const BS = '\\'; // single backslash character

for (const node of data.nodes) {
  if (node.type === 'n8n-nodes-base.code' && node.name?.toLowerCase().includes('auto-notify')) {
    let code = node.parameters.jsCode;

    // 1. Fix looksLikeMutation — add 'foi alterado' and 'alterado para'
    const lmOld = `atualizad[oa]${BS}s+com${BS}s+sucesso|marcamos${BS}s+para`;
    const lmNew = `atualizad[oa]${BS}s+com${BS}s+sucesso|foi${BS}s+alterado|alterado${BS}s+para|marcamos${BS}s+para`;
    if (code.includes(lmOld)) {
      code = code.replace(lmOld, lmNew);
      console.log('✅ looksLikeMutation fixed');
    } else {
      console.error('❌ looksLikeMutation pattern not found');
    }

    // 2. Fix isResched — add same patterns
    const rsOld = `atualizad[oa]${BS}s+com${BS}s+sucesso|nova${BS}s+data|novo${BS}s+hor/i`;
    const rsNew = `atualizad[oa]${BS}s+com${BS}s+sucesso|foi${BS}s+alterado|alterado${BS}s+para|nova${BS}s+data|novo${BS}s+hor/i`;
    if (code.includes(rsOld)) {
      code = code.replace(rsOld, rsNew);
      console.log('✅ isResched fixed');
    } else {
      console.error('❌ isResched pattern not found');
    }

    // 3. clientFormatted — isCancel: add 🔴 Cancelamento indicator
    const cancelOld = `'Olá, ' + cn + '! Seu agendamento foi cancelado ✨',\n          'Seu atendimento foi cancelado com sucesso.',\n          '',\n          '📌 Serviço: ' + serv,`;
    const cancelNew = `'Olá, ' + cn + '! Seu agendamento foi cancelado.',\n          '',\n          '🔴 Cancelamento',\n          '',\n          '📌 Serviço: ' + serv,`;
    if (code.includes(cancelOld)) {
      code = code.replace(cancelOld, cancelNew);
      console.log('✅ clientFormatted cancelamento fixed');
    } else {
      console.error('❌ clientFormatted cancelamento not found (may already be updated)');
    }

    // 4. clientFormatted — isResched: add 🟡 Reagendamento indicator
    const reschedOld = `'Olá, ' + cn + '! Seu agendamento foi reagendado ✨',\n          'Seu novo horário foi atualizado com sucesso.',\n          '',\n          '📌 Serviço: ' + serv,`;
    const reschedNew = `'Olá, ' + cn + '! Seu agendamento foi reagendado.',\n          '',\n          '🟡 Reagendamento',\n          '',\n          '📌 Serviço: ' + serv,`;
    if (code.includes(reschedOld)) {
      code = code.replace(reschedOld, reschedNew);
      console.log('✅ clientFormatted reagendamento fixed');
    } else {
      console.error('❌ clientFormatted reagendamento not found (may already be updated)');
    }

    // 5. clientFormatted — novo: add 🟢 Novo agendamento indicator
    const novoOld = `'Olá, ' + cn + '! Seu agendamento foi confirmado ✨',\n          '',\n          'Seu atendimento está reservado com sucesso.',\n          '',\n          '📌 Serviço: ' + serv,`;
    const novoNew = `'Olá, ' + cn + '! Seu agendamento está confirmado.',\n          '',\n          '🟢 Novo agendamento',\n          '',\n          '📌 Serviço: ' + serv,`;
    if (code.includes(novoOld)) {
      code = code.replace(novoOld, novoNew);
      console.log('✅ clientFormatted novo fixed');
    } else {
      console.error('❌ clientFormatted novo not found (may already be updated)');
    }

    node.parameters.jsCode = code;
    break;
  }
}

writeFileSync('e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json', JSON.stringify(data, null, 2), 'utf8');
console.log('✅ File saved');
