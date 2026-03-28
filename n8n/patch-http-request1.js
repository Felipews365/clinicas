const fs = require('fs');
const p =
  process.argv[2] ||
  'C:\\Users\\felip\\.cursor\\projects\\c-Users-felip-OneDrive-Ambiente-de-Trabalho-consultorio\\agent-tools\\9289ef59-e81b-48d5-97d5-fe5c4d29ea13.txt';
let t = fs.readFileSync(p, 'utf8');
const i = t.indexOf('{');
const w = JSON.parse(t.slice(i));
const node = w.nodes.find((x) => x.name === 'HTTP Request1');
if (!node) throw new Error('HTTP Request1 not found');

// Align instance with nó "Evolution API" (tvmundo) — URL fixa /felipe causava "Message not found"
node.parameters.jsonBody =
  "={{ JSON.stringify({ message: { key: { id: $('Campos iniciais').item.json.msgID, remoteJid: $('Campos iniciais').item.json.numCliente, fromMe: $('Campos iniciais').item.json.fromMe } }, convertToMp4: true }) }}";
node.parameters.url =
  "={{ `https://evo.plataformabot.top/chat/getBase64FromMediaMessage/${$('Webhook').item.json.body.instance || $env.EVOLUTION_INSTANCE || 'tvmundo'}` }}";

const out = {
  id: w.id,
  name: w.name,
  nodes: w.nodes,
  connections: w.connections,
  settings: w.settings,
};
const dest =
  'C:\\Users\\felip\\OneDrive\\Ambiente de Trabalho\\consultorio\\n8n\\workflow-patched-x22.json';
fs.writeFileSync(dest, JSON.stringify(out, null, 2), 'utf8');
console.log('Wrote', dest);
