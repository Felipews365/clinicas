/**
 * Sincroniza o arquivo local workflow-kCX2-live.json com as mudanças do tool agd_cs_consultar_vagas
 */
import { readFileSync, writeFileSync } from 'fs';

const NEW_JSON_BODY = `={{ '{"p_clinic_id":"' + $('Code merge webhook e resolucao').first().json.clinica_id + '","p_data":"{data_solicitada}","p_profissional_id":' + ('{profissional_id}' === 'null' ? 'null' : '"' + '{profissional_id}' + '"') + '}' }}`;

const NEW_TOOL_DESCRIPTION = `Lista horários disponíveis de um profissional em um dia específico.
Sempre pergunte ao cliente qual data deseja ANTES de chamar esta tool.
Parâmetros:
- data_solicitada: data no formato YYYY-MM-DD (obrigatório)
- profissional_id: UUID do profissional (obrigatório quando o cliente já escolheu o profissional; use null se ainda não souber)
Retorna array com horários livres. Mostre apenas os horários — NUNCA mencione preços.`;

const files = ['workflow-kCX2-live.json', 'workflow-kCX2-multi-agent.json'];

for (const filename of files) {
  try {
    const content = readFileSync(filename, 'utf8');
    const wf = JSON.parse(content);
    let patched = 0;

    function patchNodes(arr) {
      if (!Array.isArray(arr)) return;
      for (const node of arr) {
        if (node.name === 'agd_cs_consultar_vagas' && node.type === '@n8n/n8n-nodes-langchain.toolHttpRequest') {
          node.parameters = {
            ...node.parameters,
            toolDescription: NEW_TOOL_DESCRIPTION,
            jsonBody: NEW_JSON_BODY,
            sendHeaders: true,
            headerParameters: {
              parameters: [{ name: 'Prefer', value: 'params=single-object' }],
            },
            placeholderDefinitions: {
              values: [
                {
                  name: 'data_solicitada',
                  description: 'Data desejada em formato YYYY-MM-DD. Pergunte ao cliente antes de chamar.',
                  type: 'string',
                },
                {
                  name: 'profissional_id',
                  description: 'UUID do profissional escolhido pelo cliente. Use null se ainda não souber.',
                  type: 'string',
                },
              ],
            },
          };
          patched++;
        }
      }
    }

    patchNodes(wf.nodes);
    patchNodes(wf.activeVersion?.nodes);

    if (patched > 0) {
      writeFileSync(filename, JSON.stringify(wf, null, 2), 'utf8');
      console.log(`${filename}: ${patched} node(s) atualizados.`);
    } else {
      console.log(`${filename}: tool não encontrado.`);
    }
  } catch (e) {
    console.error(`${filename}: erro - ${e.message}`);
  }
}
