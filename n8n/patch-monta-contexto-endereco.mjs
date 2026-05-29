/**
 * Injeta no node Monta Contexto:
 *  - bloco de endereço/link Maps em `instr_faq` (texto)
 *  - latitude/longitude/instance_name no contexto (para envio nativo)
 *  - regra: agente_faq adiciona [SEND_LOCATION] no final quando responde sobre endereço
 *
 * Tenant-safe: lê de clinics.agent_instructions (campos endereco, link_localizacao,
 * latitude, longitude) que o painel guarda por clínica.
 *
 * Uso: node n8n/patch-monta-contexto-endereco.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wfPath = path.join(__dirname, "workflow-kCX2-live.json");

const MARKER_V1 = "// [PATCH: endereco e link maps no instr_faq]";
const MARKER_V2 = "// [PATCH: endereco/localizacao v2]";

const INJECT = `${MARKER_V2}
const _endereco = (instr_raw && typeof instr_raw.endereco === 'string') ? instr_raw.endereco.trim() : '';
const _mapsLink = (instr_raw && typeof instr_raw.link_localizacao === 'string') ? instr_raw.link_localizacao.trim() : '';
const _latRaw = instr_raw && instr_raw.latitude;
const _lngRaw = instr_raw && instr_raw.longitude;
const _lat = (typeof _latRaw === 'number' && Number.isFinite(_latRaw)) ? _latRaw : (typeof _latRaw === 'string' && _latRaw.trim() !== '' && Number.isFinite(parseFloat(_latRaw))) ? parseFloat(_latRaw) : null;
const _lng = (typeof _lngRaw === 'number' && Number.isFinite(_lngRaw)) ? _lngRaw : (typeof _lngRaw === 'string' && _lngRaw.trim() !== '' && Number.isFinite(parseFloat(_lngRaw))) ? parseFloat(_lngRaw) : null;
const _hasNativeLocation = _lat !== null && _lng !== null;
let _enderecoFaqBlock = '';
if (_endereco || _mapsLink || _hasNativeLocation) {
  _enderecoFaqBlock = '\\n\\n### ENDERECO DA CLINICA';
  if (_endereco) _enderecoFaqBlock += '\\nEndereco: ' + _endereco;
  if (_mapsLink && !_hasNativeLocation) _enderecoFaqBlock += '\\nLink Google Maps: ' + _mapsLink;
  if (_hasNativeLocation) {
    _enderecoFaqBlock += '\\n\\nREGRA OBRIGATORIA: quando o cliente pedir endereco, localizacao, "onde fica" ou "como chegar":';
    _enderecoFaqBlock += '\\n1. Responda em UMA frase curta confirmando o endereco (ex.: "A clinica fica em ' + (_endereco || 'nosso endereco') + '.").';
    _enderecoFaqBlock += '\\n2. NA ULTIMA LINHA, escreva EXACTAMENTE o marcador: [SEND_LOCATION]';
    _enderecoFaqBlock += '\\n3. NAO mande o link do Google Maps no texto, NAO use markdown. O sistema vai enviar o card de localizacao nativo do WhatsApp automaticamente.';
  } else {
    _enderecoFaqBlock += '\\n\\nREGRA OBRIGATORIA: quando o cliente pedir endereco, localizacao, "onde fica", "como chegar" ou similar, responda SEMPRE com as linhas acima (endereco + link do Maps, se houver). Nao invente endereco, nao parafraseie, nao omita o link.';
  }
}
`;

const TAIL_OLD_V1 = `  instr_outros:     instr_raw.outros      || '',
  instr_faq_endereco: _enderecoFaqBlock || '',`;
const TAIL_OLD_PLAIN = `  instr_outros:     instr_raw.outros      || '',`;
const TAIL_NEW = `  instr_outros:     instr_raw.outros      || '',
  instr_faq_endereco: _enderecoFaqBlock || '',
  loc_latitude: _lat,
  loc_longitude: _lng,
  loc_name: clinic_name || '',
  loc_address: _endereco || '',
  loc_has_native: _hasNativeLocation,`;

const INSTR_FAQ_OLD_PLAIN = `  instr_faq:        instr_raw.orientacoes || '',`;
const INSTR_FAQ_OLD_PATCHED = `  instr_faq:        ((instr_raw.orientacoes || '') + (_enderecoFaqBlock || '')) || '',`;
const INSTR_FAQ_NEW = INSTR_FAQ_OLD_PATCHED;

function patchCode(js) {
  if (typeof js !== "string") return js;
  if (js.includes(MARKER_V2)) return js;
  const hadV1 = js.includes(MARKER_V1);

  // Remove old V1 block (entre MARKER_V1 e a linha em branco anterior ao `return`)
  if (hadV1) {
    const v1Pattern = /\/\/ \[PATCH: endereco e link maps no instr_faq\][\s\S]*?\n}\n\n(?=return \[\{ json: \{)/;
    js = js.replace(v1Pattern, "");
  }

  const RETURN_ANCHOR = "return [{ json: {\n  mensagem,";
  if (!js.includes(RETURN_ANCHOR)) {
    console.warn("Monta Contexto: âncora return não encontrada");
    return js;
  }
  let next = js.replace(RETURN_ANCHOR, INJECT.trim() + "\n\n" + RETURN_ANCHOR);

  if (next.includes(INSTR_FAQ_OLD_PATCHED)) {
    // já patchado para V1, nada a fazer no campo instr_faq
  } else if (next.includes(INSTR_FAQ_OLD_PLAIN)) {
    next = next.replace(INSTR_FAQ_OLD_PLAIN, INSTR_FAQ_NEW);
  } else {
    console.warn("Monta Contexto: instr_faq não encontrado");
    return js;
  }

  if (next.includes(TAIL_OLD_V1)) {
    next = next.replace(TAIL_OLD_V1, TAIL_NEW);
  } else if (next.includes(TAIL_OLD_PLAIN)) {
    next = next.replace(TAIL_OLD_PLAIN, TAIL_NEW);
  }
  return next;
}

function walk(nodes, label) {
  let n = 0;
  if (!Array.isArray(nodes)) return 0;
  for (const node of nodes) {
    if (node?.name === "Monta Contexto" && node?.type === "n8n-nodes-base.code") {
      const next = patchCode(node.parameters?.jsCode);
      if (next !== node.parameters.jsCode) {
        node.parameters = node.parameters || {};
        node.parameters.jsCode = next;
        n++;
        console.log(`  ✓ ${label} Monta Contexto (${node.id})`);
      }
    }
  }
  return n;
}

const workflow = JSON.parse(readFileSync(wfPath, "utf8"));
let total = walk(workflow.nodes, "nodes");
if (workflow.activeVersion?.nodes) {
  total += walk(workflow.activeVersion.nodes, "activeVersion");
}

writeFileSync(wfPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log(`Monta Contexto: ${total} node(s) atualizados → ${wfPath}`);
