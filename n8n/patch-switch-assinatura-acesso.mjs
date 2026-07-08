#!/usr/bin/env node
/**
 * Insere o "Switch assinatura e acesso" entre Buscar Config Cl?nica e IF Agente Ativo.
 *
 * Roteamento:
 *   - clinica_nao_encontrada  -> NoOp (encerra silencioso)
 *   - teste_expirado          -> RPC throttle -> IF deve avisar -> Evolution sendText -> NoOp
 *   - plano_expirado          -> RPC throttle -> IF deve avisar -> Evolution sendText -> NoOp
 *   - ativo                   -> IF Agente Ativo (fluxo normal)
 *
 * Tenant-safe: RPC recebe clinic_id e telefone; texto interpola clinic_name lido
 * de Buscar Config Cl?nica.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = './n8n/workflow-kCX2-live.json';
const SUPABASE_BASE =
  "={{ 'https://xkwdwioawosthwjqijfb.supabase.co'.replace(/\\/+$/, '') }}";

const wf = JSON.parse(readFileSync(FILE, 'utf8'));

const TEXTO_TESTE = (
  'Olá! 👋 O período de teste do atendimento automático da {clinic_name} ' +
  'terminou. Para agendar, tirar dúvidas ou reactivar o atendimento, ' +
  'por favor entre em contacto directamente com a clínica. Obrigado!'
);
const TEXTO_MENSAL = (
  'Olá! 👋 No momento o atendimento automático da {clinic_name} está ' +
  'indisponível. Para agendar ou tirar dúvidas, por favor entre em ' +
  'contacto directamente com a clínica. Obrigado!'
);

function buildNodes() {
  // posições à direita de Buscar Config Cl?nica (-2688,-336) e IF Agente Ativo (-2568,-336)
  // vou mover IF Agente Ativo para a direita e meter o switch onde ele estava
  const switchPos = [-2528, -336];
  const noopVazioPos = [-2360, -560];

  const httpTestePos = [-2360, -400];
  const ifTestePos = [-2200, -400];
  const evoTestePos = [-2040, -440];
  const noopTesteEndPos = [-2040, -340];

  const httpMensalPos = [-2360, -240];
  const ifMensalPos = [-2200, -240];
  const evoMensalPos = [-2040, -280];
  const noopMensalEndPos = [-2040, -180];

  return [
    {
      id: 'switch-assinatura-acesso-v1',
      name: 'Switch assinatura e acesso',
      type: 'n8n-nodes-base.switch',
      typeVersion: 3.2,
      position: switchPos,
      parameters: {
        rules: {
          values: [
            {
              outputKey: 'clinica_nao_encontrada',
              conditions: {
                options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
                combinator: 'and',
                conditions: [
                  {
                    id: 'cond-cnf',
                    leftValue: "={{ $json.id ?? '' }}",
                    rightValue: '',
                    operator: { type: 'string', operation: 'empty', singleValue: true },
                  },
                ],
              },
              renameOutput: true,
            },
            {
              outputKey: 'teste_expirado',
              conditions: {
                options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 3 },
                combinator: 'and',
                conditions: [
                  {
                    id: 'cond-te-plano',
                    leftValue: "={{ String($json.tipo_plano ?? '').toLowerCase() }}",
                    rightValue: 'teste',
                    operator: { type: 'string', operation: 'equals' },
                  },
                  {
                    id: 'cond-te-data',
                    leftValue: "={{ String($json.data_expiracao ?? '').slice(0,10) }}",
                    rightValue: "={{ $now.setZone('America/Sao_Paulo').toFormat('yyyy-MM-dd') }}",
                    operator: { type: 'string', operation: 'notEmpty', singleValue: true },
                  },
                  {
                    id: 'cond-te-vencida',
                    leftValue: "={{ String($json.data_expiracao ?? '').slice(0,10) < $now.setZone('America/Sao_Paulo').toFormat('yyyy-MM-dd') }}",
                    rightValue: true,
                    operator: { type: 'boolean', operation: 'true', singleValue: true },
                  },
                ],
              },
              renameOutput: true,
            },
            {
              outputKey: 'plano_expirado',
              conditions: {
                options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 3 },
                combinator: 'or',
                conditions: [
                  {
                    id: 'cond-pe-vencido',
                    leftValue: "={{ String($json.data_expiracao ?? '').length === 10 && String($json.data_expiracao).slice(0,10) < $now.setZone('America/Sao_Paulo').toFormat('yyyy-MM-dd') }}",
                    rightValue: true,
                    operator: { type: 'boolean', operation: 'true', singleValue: true },
                  },
                  {
                    id: 'cond-pe-ativo-false',
                    leftValue: '={{ $json.ativo }}',
                    rightValue: false,
                    operator: { type: 'boolean', operation: 'equals' },
                  },
                  {
                    id: 'cond-pe-inad',
                    leftValue: '={{ $json.inadimplente }}',
                    rightValue: true,
                    operator: { type: 'boolean', operation: 'equals' },
                  },
                ],
              },
              renameOutput: true,
            },
          ],
        },
        fallbackOutput: 'extra',
        options: { fallbackOutput: 'extra', renameFallbackOutput: 'ativo' },
      },
    },
    {
      id: 'noop-clinica-nao-encontrada-v1',
      name: 'NoOp clinica nao encontrada',
      type: 'n8n-nodes-base.noOp',
      typeVersion: 1,
      position: noopVazioPos,
      parameters: {},
    },
    // --- ramo teste_expirado ---
    {
      id: 'http-marca-aviso-teste-v1',
      name: 'HTTP marca aviso teste',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: httpTestePos,
      parameters: {
        method: 'POST',
        url: `${SUPABASE_BASE} + '/rest/v1/rpc/n8n_cs_bloqueio_aviso_marcar'`,
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'supabaseApi',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Prefer', value: 'return=representation' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          "={{ JSON.stringify({ p_clinic_id: $('Buscar Config Cl?nica').first().json.id, p_phone: $('Edit Fields1').first().json.numCliente }) }}",
        options: {},
      },
      credentials: {
        supabaseApi: { id: 'SmHWpBnyL1cYuhlm', name: 'Supabase clinicas' },
      },
    },
    {
      id: 'if-deve-avisar-teste-v1',
      name: 'IF deve avisar teste',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: ifTestePos,
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
          combinator: 'and',
          conditions: [
            {
              id: 'cond-avisar-te',
              leftValue: '={{ $json === true || $json[0] === true }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'equals' },
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'evolution-aviso-teste-v1',
      name: 'Evolution aviso teste',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: evoTestePos,
      parameters: {
        method: 'POST',
        url: "={{ 'https://evolutionapi.vps7846.panel.icontainer.cloud/message/sendText/' + ($('Edit Fields1').first().json.instanceName || '') }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'apikey', value: '6PWyAsF3cip8QZ2JxNSRk4M5A5yEi4G8' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ number: $('Edit Fields1').first().json.numCliente, text: ${JSON.stringify(TEXTO_TESTE)}.replace('{clinic_name}', $('Buscar Config Cl?nica').first().json.name || 'a clínica'), delay: 1500 }) }}`,
        options: {},
      },
      onError: 'continueRegularOutput',
    },
    {
      id: 'noop-fim-teste-v1',
      name: 'NoOp fim teste expirado',
      type: 'n8n-nodes-base.noOp',
      typeVersion: 1,
      position: noopTesteEndPos,
      parameters: {},
    },
    // --- ramo plano_expirado ---
    {
      id: 'http-marca-aviso-mensal-v1',
      name: 'HTTP marca aviso mensal',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: httpMensalPos,
      parameters: {
        method: 'POST',
        url: `${SUPABASE_BASE} + '/rest/v1/rpc/n8n_cs_bloqueio_aviso_marcar'`,
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'supabaseApi',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Prefer', value: 'return=representation' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          "={{ JSON.stringify({ p_clinic_id: $('Buscar Config Cl?nica').first().json.id, p_phone: $('Edit Fields1').first().json.numCliente }) }}",
        options: {},
      },
      credentials: {
        supabaseApi: { id: 'SmHWpBnyL1cYuhlm', name: 'Supabase clinicas' },
      },
    },
    {
      id: 'if-deve-avisar-mensal-v1',
      name: 'IF deve avisar mensal',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: ifMensalPos,
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
          combinator: 'and',
          conditions: [
            {
              id: 'cond-avisar-me',
              leftValue: '={{ $json === true || $json[0] === true }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'equals' },
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'evolution-aviso-mensal-v1',
      name: 'Evolution aviso mensal',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: evoMensalPos,
      parameters: {
        method: 'POST',
        url: "={{ 'https://evolutionapi.vps7846.panel.icontainer.cloud/message/sendText/' + ($('Edit Fields1').first().json.instanceName || '') }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'apikey', value: '6PWyAsF3cip8QZ2JxNSRk4M5A5yEi4G8' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ number: $('Edit Fields1').first().json.numCliente, text: ${JSON.stringify(TEXTO_MENSAL)}.replace('{clinic_name}', $('Buscar Config Cl?nica').first().json.name || 'a clínica'), delay: 1500 }) }}`,
        options: {},
      },
      onError: 'continueRegularOutput',
    },
    {
      id: 'noop-fim-mensal-v1',
      name: 'NoOp fim mensal bloqueado',
      type: 'n8n-nodes-base.noOp',
      typeVersion: 1,
      position: noopMensalEndPos,
      parameters: {},
    },
  ];
}

function applyToBlock(blockNodes, blockConnections) {
  // 1) Aumentar select de Buscar Config Cl?nica
  const busc = blockNodes.find((n) => n.name === 'Buscar Config Cl?nica');
  if (busc) {
    const qp = busc.parameters?.queryParameters?.parameters ?? [];
    const sel = qp.find((p) => p.name === 'select');
    if (sel && !/tipo_plano/.test(sel.value)) {
      sel.value =
        'id,name,phone,timezone,agent_instructions,agenda_visible_hours,sabado_aberto,sabado_agenda_hours,agente_ativo,tipo_plano,data_expiracao,ativo,inadimplente';
    }
  }

  // 2) Inserir os novos nodes (idempotente — remover antes se já existirem)
  const newNodes = buildNodes();
  const newNames = new Set(newNodes.map((n) => n.name));
  for (let i = blockNodes.length - 1; i >= 0; i--) {
    if (newNames.has(blockNodes[i].name)) blockNodes.splice(i, 1);
  }
  blockNodes.push(...newNodes);

  // 3) Mover IF Agente Ativo para a direita do Switch
  const ifAtivo = blockNodes.find((n) => n.name === 'IF Agente Ativo');
  if (ifAtivo) ifAtivo.position = [-2360, -120];

  // 4) Reconfigurar conexões
  // Buscar Config Cl?nica -> Switch (em vez de IF Agente Ativo)
  blockConnections['Buscar Config Cl?nica'] = {
    main: [[{ node: 'Switch assinatura e acesso', type: 'main', index: 0 }]],
  };

  // Switch -> 4 saídas
  blockConnections['Switch assinatura e acesso'] = {
    main: [
      // output 0 = clinica_nao_encontrada
      [{ node: 'NoOp clinica nao encontrada', type: 'main', index: 0 }],
      // output 1 = teste_expirado
      [{ node: 'HTTP marca aviso teste', type: 'main', index: 0 }],
      // output 2 = plano_expirado
      [{ node: 'HTTP marca aviso mensal', type: 'main', index: 0 }],
      // output 3 = fallback ativo
      [{ node: 'IF Agente Ativo', type: 'main', index: 0 }],
    ],
  };

  // Ramo teste
  blockConnections['HTTP marca aviso teste'] = {
    main: [[{ node: 'IF deve avisar teste', type: 'main', index: 0 }]],
  };
  blockConnections['IF deve avisar teste'] = {
    main: [
      [{ node: 'Evolution aviso teste', type: 'main', index: 0 }],
      [{ node: 'NoOp fim teste expirado', type: 'main', index: 0 }],
    ],
  };
  blockConnections['Evolution aviso teste'] = {
    main: [[{ node: 'NoOp fim teste expirado', type: 'main', index: 0 }]],
  };

  // Ramo mensal
  blockConnections['HTTP marca aviso mensal'] = {
    main: [[{ node: 'IF deve avisar mensal', type: 'main', index: 0 }]],
  };
  blockConnections['IF deve avisar mensal'] = {
    main: [
      [{ node: 'Evolution aviso mensal', type: 'main', index: 0 }],
      [{ node: 'NoOp fim mensal bloqueado', type: 'main', index: 0 }],
    ],
  };
  blockConnections['Evolution aviso mensal'] = {
    main: [[{ node: 'NoOp fim mensal bloqueado', type: 'main', index: 0 }]],
  };
}

applyToBlock(wf.nodes, wf.connections);
if (wf.activeVersion?.nodes && wf.activeVersion?.connections) {
  applyToBlock(wf.activeVersion.nodes, wf.activeVersion.connections);
}

writeFileSync(FILE, JSON.stringify(wf, null, 2));
console.log('ok — patch aplicado (top-level + activeVersion).');
