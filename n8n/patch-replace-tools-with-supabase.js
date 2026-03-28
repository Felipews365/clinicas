/**
 * Substitui toolCode (fetch REST) por nós Supabase nativos como ferramentas do AI Agent.
 * Uso: node n8n/patch-replace-tools-with-supabase.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const uid = () => crypto.randomUUID();

const root = path.join(__dirname, 'workflow-patched-x22.json');
const wf = JSON.parse(fs.readFileSync(root, 'utf8'));

const removeIds = new Set([
  '8129dd7b-a5a4-4c8e-8ce3-f9c7446aee11',
  'ab269a84-828a-46b6-bea9-a89f42249113',
  'ef6f63a2-6ae9-44d4-a6a1-f3943ca4158f',
  '19d62b28-819d-420c-a218-503fa24e49bc',
  'd056da97-0db9-4d31-b52c-816055b08256',
]);

wf.nodes = wf.nodes.filter((n) => !removeIds.has(n.id));

const cred = {
  supabaseApi: {
    id: 'SmHWpBnyL1cYuhlm',
    name: 'Supabase clinicas',
  },
};

const p = (x, y) => [x, y];

const supNodes = [
  {
    parameters: {
      toolDescription:
        'Cria um novo registo em Agendamentos. Use só depois de confirmar dados com o cliente e de verificar horários livres com sb_listar_ocupados_na_data. data_agendamento: YYYY-MM-DD; horario: HH:MM ou HH:MM:SS.',
      useCustomSchema: false,
      resource: 'row',
      operation: 'create',
      tableId: 'Agendamentos',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          {
            fieldId: 'nome_cliente',
            fieldValue: "={{ $fromAI('nome_cliente','Nome completo do cliente','string') }}",
          },
          {
            fieldId: 'telefone_cliente',
            fieldValue: "={{ $fromAI('telefone_cliente','Telefone com DDD','string') }}",
          },
          {
            fieldId: 'data_agendamento',
            fieldValue: "={{ $fromAI('data_agendamento','Data YYYY-MM-DD','string') }}",
          },
          { fieldId: 'horario', fieldValue: "={{ $fromAI('horario','Horário HH:MM','string') }}" },
          {
            fieldId: 'tipo_servico',
            fieldValue: "={{ $fromAI('tipo_servico','Tipo de serviço','string') }}",
          },
          {
            fieldId: 'observacoes',
            fieldValue: "={{ $fromAI('observacoes','Observações opcionais','string','') }}",
          },
          { fieldId: 'status', fieldValue: 'agendado' },
        ],
      },
    },
    type: 'n8n-nodes-base.supabase',
    typeVersion: 1,
    position: p(-2240, 2736),
    id: uid(),
    name: 'sb_criar_agendamento',
    credentials: cred,
  },
  {
    parameters: {
      toolDescription:
        'Lista agendamentos ativos (agendado ou reagendado) por telefone. Passe só os dígitos. O resultado traz o campo id (UUID) completo — guarde-o para reagendar ou cancelar.',
      useCustomSchema: false,
      resource: 'row',
      operation: 'getAll',
      tableId: 'Agendamentos',
      returnAll: true,
      filterType: 'string',
      filterString:
        "={{ 'and=(status.in.(agendado,reagendado),telefone_cliente.ilike.*' + $fromAI('telefone_digitos','Apenas dígitos do telefone','string').replace(/\\D/g, '') + '*)' }}",
    },
    type: 'n8n-nodes-base.supabase',
    typeVersion: 1,
    position: p(-2048, 2736),
    id: uid(),
    name: 'sb_buscar_por_telefone',
    credentials: cred,
  },
  {
    parameters: {
      toolDescription:
        'Busca agendamento ativo pelo código curto (primeiros 8 caracteres do UUID, minúsculas, sem hífenes extras). Devolve o id completo.',
      useCustomSchema: false,
      resource: 'row',
      operation: 'getAll',
      tableId: 'Agendamentos',
      returnAll: true,
      filterType: 'string',
      filterString:
        "={{ 'and=(status.in.(agendado,reagendado),id.like.*' + $fromAI('codigo_prefixo','8 primeiros caracteres hex do UUID em minúsculas','string').toLowerCase().replace(/[^a-f0-9]/g, '').substring(0, 8) + '*)' }}",
    },
    type: 'n8n-nodes-base.supabase',
    typeVersion: 1,
    position: p(-1856, 2736),
    id: uid(),
    name: 'sb_buscar_por_codigo',
    credentials: cred,
  },
  {
    parameters: {
      toolDescription:
        'Lista agendamentos já ocupados numa data (YYYY-MM-DD). Cada linha tem horario. Com as regras de expediente no prompt, diga ao cliente os horários ainda livres.',
      useCustomSchema: false,
      resource: 'row',
      operation: 'getAll',
      tableId: 'Agendamentos',
      returnAll: true,
      filterType: 'string',
      filterString:
        "={{ 'and=(data_agendamento.eq.' + $fromAI('data','Data YYYY-MM-DD','string') + ',status.in.(agendado,reagendado))' }}",
    },
    type: 'n8n-nodes-base.supabase',
    typeVersion: 1,
    position: p(-1664, 2736),
    id: uid(),
    name: 'sb_listar_ocupados_na_data',
    credentials: cred,
  },
  {
    parameters: {
      toolDescription:
        'Reagenda: exige o id UUID completo (id da linha). Atualiza data, horário e status para reagendado.',
      useCustomSchema: false,
      resource: 'row',
      operation: 'update',
      tableId: 'Agendamentos',
      filterType: 'string',
      filterString: "={{ 'id=eq.' + $fromAI('agendamento_id','UUID completo do agendamento','string') }}",
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          {
            fieldId: 'data_agendamento',
            fieldValue: "={{ $fromAI('nova_data','Nova data YYYY-MM-DD','string') }}",
          },
          {
            fieldId: 'horario',
            fieldValue: "={{ $fromAI('novo_horario','Novo horário HH:MM','string') }}",
          },
          { fieldId: 'status', fieldValue: 'reagendado' },
          { fieldId: 'updated_at', fieldValue: '={{ $now.toISO() }}' },
        ],
      },
    },
    type: 'n8n-nodes-base.supabase',
    typeVersion: 1,
    position: p(-1472, 2736),
    id: uid(),
    name: 'sb_reagendar',
    credentials: cred,
  },
  {
    parameters: {
      toolDescription:
        'Cancela agendamento: exige id UUID completo. Confirme com o cliente antes.',
      useCustomSchema: false,
      resource: 'row',
      operation: 'update',
      tableId: 'Agendamentos',
      filterType: 'string',
      filterString: "={{ 'id=eq.' + $fromAI('agendamento_id','UUID completo do agendamento','string') }}",
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'status', fieldValue: 'cancelado' },
          {
            fieldId: 'motivo_cancelamento',
            fieldValue:
              "={{ $fromAI('motivo','Motivo do cancelamento','string','Cancelado pelo cliente') }}",
          },
          { fieldId: 'cancelled_at', fieldValue: '={{ $now.toISO() }}' },
          { fieldId: 'updated_at', fieldValue: '={{ $now.toISO() }}' },
        ],
      },
    },
    type: 'n8n-nodes-base.supabase',
    typeVersion: 1,
    position: p(-1280, 2736),
    id: uid(),
    name: 'sb_cancelar',
    credentials: cred,
  },
];

wf.nodes.push(...supNodes);

const oldConnKeys = [
  'Tool Agendar',
  'Tool Reagendar',
  'Tool Cancelar',
  'Tool Buscar Agendamentos',
  'Tool Consultar Horários1',
];
for (const k of oldConnKeys) delete wf.connections[k];

for (const n of supNodes) {
  wf.connections[n.name] = {
    ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]],
  };
}

const agent = wf.nodes.find((x) => x.name === 'AI Agent');
if (agent?.parameters?.options?.systemMessage) {
  let sm = agent.parameters.options.systemMessage;
  sm = sm.replace(
    /SEMPRE use a tool consultar_horarios/g,
    'SEMPRE use sb_listar_ocupados_na_data'
  );
  if (!sm.includes('## Ferramentas Supabase')) {
    sm +=
      '\n\n## Ferramentas Supabase (nós nativos)\n' +
      '- Tabela: Agendamentos.\n' +
      '- Antes de sb_reagendar ou sb_cancelar, obtenha o id UUID completo com sb_buscar_por_telefone ou sb_buscar_por_codigo.\n' +
      '- Substitui consultar_horarios: use sb_listar_ocupados_na_data e calcule os horários livres com as regras de expediente acima.\n' +
      '- Após criar, o cliente pode usar os 8 primeiros caracteres do id como código.';
  }
  agent.parameters.options.systemMessage = sm;
}

fs.writeFileSync(root, JSON.stringify(wf, null, 2), 'utf8');
console.log('OK:', supNodes.map((n) => n.name).join(', '));
