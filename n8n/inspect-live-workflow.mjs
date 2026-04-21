import { readFileSync } from 'fs';

const mcp = JSON.parse(readFileSync('../.cursor/mcp.json', 'utf8'));
const baseUrl = mcp.mcpServers.n8n.env.N8N_API_URL.replace(/\/+$/, '');
const apiKey = mcp.mcpServers.n8n.env.N8N_API_KEY;

const r = await fetch(`${baseUrl}/workflows/kCX2LfxJrdYWB0vk`, {
  headers: { 'X-N8N-API-KEY': apiKey }
});
const wf = await r.json();
const nodes = wf.nodes || [];

// 1. Quem alimenta o Check First Contact?
console.log('=== Conexões entrando em "Check First Contact" ===');
const connections = wf.connections || {};
for (const [srcName, srcConn] of Object.entries(connections)) {
  for (const [, outputs] of Object.entries(srcConn)) {
    for (const outputArr of outputs) {
      for (const conn of outputArr) {
        if (conn.node === 'Check First Contact') {
          console.log(`  "${srcName}" -> Check First Contact`);
        }
      }
    }
  }
}

// 2. Quem alimenta o Monta Contexto?
console.log('\n=== Conexões entrando em "Monta Contexto" ===');
for (const [srcName, srcConn] of Object.entries(connections)) {
  for (const [, outputs] of Object.entries(srcConn)) {
    for (const outputArr of outputs) {
      for (const conn of outputArr) {
        if (conn.node === 'Monta Contexto') {
          console.log(`  "${srcName}" -> Monta Contexto`);
        }
      }
    }
  }
}

// 3. O que Buscar Config Clínica faz?
const buscaNode = nodes.find(n => n.name === 'Buscar Config Clínica');
if (buscaNode) {
  console.log('\n=== Buscar Config Clínica params ===');
  console.log(JSON.stringify(buscaNode.parameters, null, 2).slice(0, 800));
}

// 4. Monta Contexto código completo
const montaNode = nodes.find(n => n.name === 'Monta Contexto');
if (montaNode) {
  console.log('\n=== MONTA CONTEXTO jsCode COMPLETO ===');
  console.log(montaNode.parameters?.jsCode || '');
}

// 5. Conexões saindo de "Buscar Config Clínica"
console.log('\n=== Conexões saindo de "Buscar Config Clínica" ===');
const buscaConn = connections['Buscar Config Clínica'];
if (buscaConn) {
  for (const [type, outputs] of Object.entries(buscaConn)) {
    for (const arr of outputs) {
      for (const c of arr) {
        console.log(`  -> "${c.node}" (output ${type})`);
      }
    }
  }
}
