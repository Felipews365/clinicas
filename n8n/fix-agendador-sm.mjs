import { readFileSync, writeFileSync } from 'fs';

const data = JSON.parse(readFileSync('e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json', 'utf8'));

// The new MENSAGEM AO CLIENTE section to use in BOTH agente_agendador system messages
const newMsgSection = `## MENSAGEM AO CLIENTE — APÓS TOOLS DE ESCRITA (obrigatório quando ok true)
⛔ **PROIBIDO** escrever texto livre. USE OBRIGATORIAMENTE os modelos abaixo, copiando a estrutura exata.
⛔ **PROIBIDO** usar asteriscos Markdown (*texto*), bullets • ou # no texto enviado ao cliente.
✅ Primeiro nome = primeira palavra de nome_cliente (se vazio, use "Cliente").
✅ Data sempre no formato dd/MM/aaaa.
✅ Profissional com Dr./Dra. conforme o gênero.

**MODELO — Novo agendamento (agd_cs_agendar ok:true):**
Olá, {PrimeiroNome}! Seu agendamento está confirmado.

🟢 Novo agendamento

📌 Serviço: {servico_da_tool}
👤 Profissional: {Dr_ou_Dra_nome_profissional}
📅 Data: {data_dd/MM/aaaa}
🕒 Horário: {horario_HH:mm}

Se precisar de qualquer coisa, é só responder esta mensagem.

**MODELO — Reagendamento (agd_cs_reagendar ok:true):**
Olá, {PrimeiroNome}! Seu agendamento foi reagendado.

🟡 Reagendamento

📌 Serviço: {servico_da_tool}
👤 Profissional: {Dr_ou_Dra_nome_profissional}
📅 Nova data: {nova_data_dd/MM/aaaa}
🕒 Novo horário: {novo_horario_HH:mm}

Se precisar de qualquer coisa, é só responder esta mensagem.

**MODELO — Cancelamento (agd_cs_cancelar ok:true):**
Olá, {PrimeiroNome}! Seu agendamento foi cancelado.

🔴 Cancelamento

📌 Serviço: {servico_da_tool}
👤 Profissional: {Dr_ou_Dra_nome_profissional}
📅 Data: {data_dd/MM/aaaa}
🕒 Horário: {horario_HH:mm}

Se precisar remarcar, é só responder esta mensagem.`;

// Old sections to replace in both system messages
const oldSection1 = `## MENSAGEM AO CLIENTE — APÓS TOOLS DE ESCRITA (obrigatório quando ok true)
⛔ **PROIBIDO** escrever texto livre como "O agendamento foi confirmado com a Dra. X para amanhã às 10h". USE OBRIGATORIAMENTE os modelos abaixo, copiando a estrutura exata — substitua só os campos em {}.
⛔ **PROIBIDO** usar asteriscos Markdown (*texto*), bullets • ou # no texto enviado ao cliente.
✅ O primeiro nome é a primeira palavra de nome_cliente no cabeçalho (se vazio, use "Cliente").
✅ Data sempre no formato dd/MM/aaaa (use o campo "data" do JSON retornado pela tool, não calcule).
✅ Profissional com tratamento Dr./Dra. conforme o gênero (use o nome e especialidade do JSON da tool de vagas).

**MODELO — Novo agendamento (agd_cs_agendar ok:true):**
Olá, {PrimeiroNome}! Seu agendamento está confirmado.

🟢 Novo agendamento

📌 Serviço: {servico_da_tool}
👤 Profissional: {Dr_ou_Dra_nome_profissional}
📅 Data: {data_dd/MM/aaaa}
🕒 Horário: {horario_HH:mm}

Se precisar de qualquer coisa, é só responder esta mensagem.

**MODELO — Reagendamento (agd_cs_reagendar ok:true):**
Olá, {PrimeiroNome}! Seu agendamento foi reagendado.

🟡 Reagendamento

📌 Serviço: {servico_da_tool}
👤 Profissional: {Dr_ou_Dra_nome_profissional}
📅 Nova data: {nova_data_dd/MM/aaaa}
🕒 Novo horário: {novo_horario_HH:mm}

Se precisar de qualquer coisa, é só responder esta mensagem.

**MODELO — Cancelamento (agd_cs_cancelar ok:true):**
Olá, {PrimeiroNome}! Seu agendamento foi cancelado.

🔴 Cancelamento

📌 Serviço: {servico_da_tool}
👤 Profissional: {Dr_ou_Dra_nome_profissional}
📅 Data: {data_dd/MM/aaaa}
🕒 Horário: {horario_HH:mm}

Se precisar remarcar, é só responder esta mensagem.`;

const oldSection2 = `## MENSAGEM AO CLIENTE — APÓS TOOLS DE ESCRITA (obrigatório quando ok true)
Use o **primeiro nome** do cliente (primeira palavra de nome_cliente no cabeçalho; se vazio, "Cliente").
⛔ **Proibido:** asteriscos estilo Markdown (*rótulo*), bullets "• *texto:*" ou títulos com * — o WhatsApp deve seguir o mesmo padrão visual do painel: texto simples + emojis nas linhas de detalhe.

**Reagendamento (agd_cs_reagendar):**
Olá, {PrimeiroNome}! Seu agendamento foi reagendado ✨
Seu novo horário foi atualizado com sucesso.

📌 Serviço: …
👤 Profissional: …
📅 Nova data: dd/MM/aaaa
🕒 Novo horário: HH:mm

Se precisar de qualquer coisa, é só responder esta mensagem.

**Novo agendamento (agd_cs_agendar):**
Olá, {PrimeiroNome}! Seu agendamento foi confirmado ✨

Seu atendimento está reservado com sucesso.

📌 Serviço: …
👤 Profissional: …
📅 Data: dd/MM/aaaa
🕒 Horário: HH:mm

Se precisar de qualquer coisa, é só responder esta mensagem.

**Cancelamento (agd_cs_cancelar):**
Olá, {PrimeiroNome}! Seu agendamento foi cancelado ✨
Seu atendimento foi cancelado com sucesso.

📌 Serviço: …
👤 Profissional: …
📅 Data: dd/MM/aaaa
🕒 Horário: HH:mm

Se precisar remarcar, é só responder esta mensagem.

Preencha Serviço, Profissional, Data e Horário com os **mesmos** valores que você usou na tool.`;

let count = 0;
for (const node of data.nodes) {
  if (!node.parameters?.systemMessage) continue;
  let sm = node.parameters.systemMessage;
  if (sm.includes(oldSection1)) {
    sm = sm.replace(oldSection1, newMsgSection);
    node.parameters.systemMessage = sm;
    count++;
    console.log(`✅ Updated system message in node: ${node.name}`);
  } else if (sm.includes(oldSection2)) {
    sm = sm.replace(oldSection2, newMsgSection);
    node.parameters.systemMessage = sm;
    count++;
    console.log(`✅ Updated system message in node: ${node.name}`);
  }
}

console.log(`Total nodes updated: ${count}`);
writeFileSync('e:/projeto 2026/consultorio/n8n/workflow-kCX2-live.json', JSON.stringify(data, null, 2), 'utf8');
console.log('✅ File saved');
