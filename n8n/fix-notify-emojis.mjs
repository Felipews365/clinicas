import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json', 'utf8'));

for (const node of data.nodes) {
  if (node.type === 'n8n-nodes-base.code' && node.name?.toLowerCase().includes('auto-notify')) {
    let code = node.parameters.jsCode;

    // Fix professional phone emoji: 📱 → 📞 in linhasCliente
    const phoneOld = `lines.push('\u{1F4F1} Telefone: ' + telFmt);`;
    const phoneNew = `lines.push('\u{1F4DE} Telefone: ' + telFmt);`;
    if (code.includes(phoneOld)) {
      code = code.replace(phoneOld, phoneNew);
      console.log('✅ Professional phone emoji fixed (📱 → 📞)');
    } else {
      // Try searching raw
      const idx = code.indexOf('Telefone: ');
      if (idx !== -1) {
        console.log('Context around Telefone:', JSON.stringify(code.substring(idx-5, idx+30)));
      }
      console.error('❌ Phone emoji pattern not found');
    }

    // Fix professional horario emoji: 🕘 → 🕒 in msgNovo and msgCancel
    const horaOld1 = `'\u{1F558} Horário: ' + hr`;
    const horaNew1 = `'\u{1F552} Horário: ' + hr`;
    if (code.includes(horaOld1)) {
      code = code.replaceAll(horaOld1, horaNew1);
      console.log('✅ Professional horario emoji fixed (🕘 → 🕒)');
    } else {
      console.error('❌ Horario emoji pattern not found, searching...');
      const idx2 = code.indexOf('Hor');
      if (idx2 !== -1) console.log('Context around Hor:', JSON.stringify(code.substring(idx2-5, idx2+30)));
    }

    node.parameters.jsCode = code;
    break;
  }
}

writeFileSync('e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json', JSON.stringify(data, null, 2), 'utf8');
console.log('✅ File saved');
