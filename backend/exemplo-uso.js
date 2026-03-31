/**
 * Exemplos de uso do sistema multi-tenant de WhatsApp
 * Demonstra como integrar e usar os serviços criados
 */

const {
  criarInstanciaClinica,
  deletarInstanciaClinica,
  enviarMensagemWhatsApp,
  obterDadosClinica,
  salvarDadoClinica,
  obterStatusConexao,
} = require('./clinica.service');

require('dotenv').config();

// ============================================================================
// EXEMPLO 1: Criar uma nova clínica
// ============================================================================
async function exemplo1_criarClinica() {
  console.log('\n=== EXEMPLO 1: Criar Nova Clínica ===\n');

  try {
    const clinicaId = '550e8400-e29b-41d4-a716-446655440000'; // UUID fictício

    const resultado = await criarInstanciaClinica(clinicaId);

    console.log('✅ Clínica criada com sucesso!');
    console.log(JSON.stringify(resultado, null, 2));

    // Se houver QR Code disponível
    if (resultado.qrCode) {
      console.log('\n📱 QR Code gerado. O usuário deve escanear para conectar WhatsApp.');
      // Aqui você poderia exibir o QR Code na interface web
      // Por exemplo, com: <img src="{{ qrCode }}" />
    }
  } catch (erro) {
    console.error('❌ Erro ao criar clínica:', erro.message);
  }
}

// ============================================================================
// EXEMPLO 2: Obter dados de uma clínica
// ============================================================================
async function exemplo2_obterDadosClinica() {
  console.log('\n=== EXEMPLO 2: Obter Dados da Clínica ===\n');

  try {
    const clinicaId = '550e8400-e29b-41d4-a716-446655440000';

    const dados = await obterDadosClinica(clinicaId);

    console.log('✅ Dados da clínica:');
    console.log(JSON.stringify(dados, null, 2));

    console.log('\n📋 Dados customizados:');
    console.log(dados.dados);
  } catch (erro) {
    console.error('❌ Erro ao obter dados:', erro.message);
  }
}

// ============================================================================
// EXEMPLO 3: Salvar dados customizados da clínica
// ============================================================================
async function exemplo3_salvarDados() {
  console.log('\n=== EXEMPLO 3: Salvar Dados Customizados ===\n');

  try {
    const clinicaId = '550e8400-e29b-41d4-a716-446655440000';

    // Dados que uma clínica poderia ter
    const dadosParaSalvar = {
      endereco: 'Rua das Flores, 123 - São Paulo, SP',
      telefone: '(11) 3456-7890',
      horario_funcionamento: 'Seg-Sex: 08:00-18:00 | Sab: 09:00-13:00',
      especialidades: 'Clínica Geral, Pediatria, Cardiologia',
      responsavel: 'Dr. João Silva',
      cnpj: '12.345.678/0001-90',
    };

    // Salvar cada dado
    for (const [chave, valor] of Object.entries(dadosParaSalvar)) {
      await salvarDadoClinica(clinicaId, chave, valor);
    }

    console.log('✅ Todos os dados foram salvos com sucesso!');

    // Verificar dados salvos
    const dadosVerificacao = await obterDadosClinica(clinicaId);
    console.log('\n📋 Dados salvos:');
    console.log(dadosVerificacao.dados);
  } catch (erro) {
    console.error('❌ Erro ao salvar dados:', erro.message);
  }
}

// ============================================================================
// EXEMPLO 4: Verificar status de conexão
// ============================================================================
async function exemplo4_verificarStatus() {
  console.log('\n=== EXEMPLO 4: Verificar Status de Conexão ===\n');

  try {
    const nomeInstancia = 'clinica-550e8400';

    const status = await obterStatusConexao(nomeInstancia);

    if (!status) {
      console.log('⚠️ Instância não encontrada');
      return;
    }

    console.log('✅ Status da conexão:');
    console.log(JSON.stringify(status, null, 2));

    const estadoTexto = {
      open: '✅ Conectado',
      connecting: '⏳ Conectando',
      close: '❌ Desconectado',
    };

    console.log(`\nEstado: ${estadoTexto[status.estado] || status.estado}`);
    if (status.telefone) {
      console.log(`Telefone: ${status.telefone}`);
    }
  } catch (erro) {
    console.error('❌ Erro ao verificar status:', erro.message);
  }
}

// ============================================================================
// EXEMPLO 5: Enviar mensagem de teste
// ============================================================================
async function exemplo5_enviarMensagemTeste() {
  console.log('\n=== EXEMPLO 5: Enviar Mensagem de Teste ===\n');

  try {
    const nomeInstancia = 'clinica-550e8400';
    const telefonePaciente = '11999999999'; // Sem formatação
    const mensagem = 'Olá! Esta é uma mensagem de teste da clínica.';

    const resultado = await enviarMensagemWhatsApp(
      nomeInstancia,
      telefonePaciente,
      mensagem
    );

    console.log('✅ Mensagem enviada com sucesso!');
    console.log(JSON.stringify(resultado, null, 2));
  } catch (erro) {
    console.error('❌ Erro ao enviar mensagem:', erro.message);
  }
}

// ============================================================================
// EXEMPLO 6: Simular recebimento de mensagem (o que o webhook faria)
// ============================================================================
async function exemplo6_simularWebhookMensagem() {
  console.log('\n=== EXEMPLO 6: Simular Webhook de Mensagem ===\n');

  // Este seria o payload que viria do Evolution API
  const payloadEvolution = {
    event: 'MESSAGES_UPSERT',
    instance: 'clinica-550e8400',
    data: {
      key: '11999999999', // Telefone do paciente
      status: 'RECEIVED',
      message: {
        body: 'Olá, gostaria de agendar uma consulta',
        timestamp: Date.now(),
        fromMe: false,
      },
    },
    apikey: process.env.EVOLUTION_API_KEY,
  };

  console.log('📨 Payload do Evolution API:');
  console.log(JSON.stringify(payloadEvolution, null, 2));

  console.log('\n🔄 Este payload será:');
  console.log('1. Recebido pelo webhook n8n em /webhook/whatsapp');
  console.log('2. Validado para encontrar a clínica (via instancia_evolution)');
  console.log('3. Checado acesso na VIEW clinicas_acesso');
  console.log('4. Recuperado histórico da conversa');
  console.log('5. Chamada Claude API com prompt da clínica');
  console.log('6. Resposta enviada via Evolution API');
  console.log('7. Histórico salvo no Supabase (máx 20 mensagens)');
}

// ============================================================================
// EXEMPLO 7: Deletar uma clínica
// ============================================================================
async function exemplo7_deletarClinica() {
  console.log('\n=== EXEMPLO 7: Deletar Clínica ===\n');

  try {
    const clinicaId = '550e8400-e29b-41d4-a716-446655440000';
    const nomeInstancia = 'clinica-550e8400';

    const resultado = await deletarInstanciaClinica(clinicaId, nomeInstancia);

    console.log('✅ Clínica deletada com sucesso!');
    console.log(JSON.stringify(resultado, null, 2));

    console.log('\n🗑️ Ações realizadas:');
    console.log('- Instância removida da Evolution API');
    console.log('- Dados da clínica limpos no Supabase');
    console.log('- Dados customizados mantidos para auditoria');
  } catch (erro) {
    console.error('❌ Erro ao deletar clínica:', erro.message);
  }
}

// ============================================================================
// EXEMPLO 8: Fluxo completo de onboarding
// ============================================================================
async function exemplo8_fluxoOnboarding() {
  console.log('\n=== EXEMPLO 8: Fluxo Completo de Onboarding ===\n');

  try {
    const clinicaId = '550e8400-e29b-41d4-a716-446655440000';

    console.log('📝 Passo 1: Criar instância...');
    const instancia = await criarInstanciaClinica(clinicaId);
    console.log('✅ Instância criada!');

    if (instancia.qrCode) {
      console.log('📱 QR Code disponível - usuário deve escanear');
    }

    console.log('\n📝 Passo 2: Salvar dados da clínica...');
    await salvarDadoClinica(clinicaId, 'nome_clinica', 'Clínica Exemplo');
    await salvarDadoClinica(clinicaId, 'responsavel', 'Dra. Maria Silva');
    await salvarDadoClinica(clinicaId, 'telefone', '(11) 3456-7890');
    console.log('✅ Dados salvos!');

    console.log('\n📝 Passo 3: Verificar status...');
    const status = await obterStatusConexao(instancia.nomeInstancia);
    console.log(`✅ Status: ${status?.estado || 'aguardando_qr'}`);

    console.log('\n📝 Passo 4: Obter dados completos...');
    const dados = await obterDadosClinica(clinicaId);
    console.log('✅ Dados:');
    console.log(`   - Nome: ${dados.nome}`);
    console.log(`   - Instância: ${dados.instancia_evolution}`);
    console.log(`   - Plano: ${dados.plano}`);
    console.log(`   - Ativo: ${dados.ativo}`);

    console.log('\n🎉 Onboarding completo! Clínica pronta para receber mensagens.');
  } catch (erro) {
    console.error('❌ Erro no fluxo de onboarding:', erro.message);
  }
}

// ============================================================================
// EXEMPLO 9: Estados de acesso (via VIEW clinicas_acesso)
// ============================================================================
async function exemplo9_estadosAcesso() {
  console.log('\n=== EXEMPLO 9: Estados de Acesso (VIEW clinicas_acesso) ===\n');

  console.log('📊 Estados possíveis:');
  console.log(`
  ┌─────────────────┬─────────────────────┬─────────────────────┐
  │ Status          │ Condição            │ Comportamento       │
  ├─────────────────┼─────────────────────┼─────────────────────┤
  │ liberado        │ Ativa + no prazo    │ ✅ Aceita mensagens │
  │ trial_expirado  │ Trial vencido       │ ❌ Bloqueia         │
  │ inadimplente    │ Assinatura vencida  │ ❌ Bloqueia         │
  │ bloqueado       │ ativo = false       │ ❌ Bloqueia         │
  └─────────────────┴─────────────────────┴─────────────────────┘
  `);

  console.log('💡 Como funciona:');
  console.log('- A VIEW clinicas_acesso calcula status em TEMPO REAL');
  console.log('- Não precisa atualizar manualmente');
  console.log('- CRON diário executa bloquear_clinicas_vencidas()');
  console.log('- Webhook de pagamento chama reativar_clinica()');
}

// ============================================================================
// EXEMPLO 10: Integração Express simples
// ============================================================================
async function exemplo10_expressIntegration() {
  console.log('\n=== EXEMPLO 10: Integração Express ===\n');

  const codigo = `
// backend/server.js
const express = require('express');
const { criarInstanciaClinica } = require('./clinica.service');
const pagamentoWebhook = require('./pagamento.webhook');
require('dotenv').config();

const app = express();
app.use(express.json());

// Webhook de pagamentos
app.use('/webhooks', pagamentoWebhook);

// Endpoint para criar clínica (proteger com autenticação JWT!)
app.post('/api/clinicas', async (req, res) => {
  try {
    const { clinicaId, nome, promptAgente } = req.body;

    // Criar instância
    const resultado = await criarInstanciaClinica(clinicaId);

    // Salvar prompt personalizado
    const { criarClinica } = require('./database');
    await criarClinica({
      id: clinicaId,
      nome,
      prompt_agente: promptAgente,
    });

    res.json(resultado);
  } catch (erro) {
    res.status(500).json({ erro: erro.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(3000, () => console.log('Servidor rodando na porta 3000'));
  `;

  console.log(codigo);
}

// ============================================================================
// Menu principal
// ============================================================================
async function executarExemplo(numero) {
  const exemplos = {
    1: exemplo1_criarClinica,
    2: exemplo2_obterDadosClinica,
    3: exemplo3_salvarDados,
    4: exemplo4_verificarStatus,
    5: exemplo5_enviarMensagemTeste,
    6: exemplo6_simularWebhookMensagem,
    7: exemplo7_deletarClinica,
    8: exemplo8_fluxoOnboarding,
    9: exemplo9_estadosAcesso,
    10: exemplo10_expressIntegration,
  };

  const exemplo = exemplos[numero];

  if (!exemplo) {
    console.log('❌ Exemplo não encontrado');
    return;
  }

  await exemplo();
}

// Se executado com argumento: node exemplo-uso.js 1
if (process.argv[2]) {
  executarExemplo(parseInt(process.argv[2]));
} else {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   EXEMPLOS DE USO - SISTEMA MULTI-TENANT WHATSAPP         ║
╚════════════════════════════════════════════════════════════╝

Executar exemplos:
  node backend/exemplo-uso.js 1   # Criar clínica
  node backend/exemplo-uso.js 2   # Obter dados
  node backend/exemplo-uso.js 3   # Salvar dados customizados
  node backend/exemplo-uso.js 4   # Verificar status
  node backend/exemplo-uso.js 5   # Enviar mensagem
  node backend/exemplo-uso.js 6   # Simular webhook
  node backend/exemplo-uso.js 7   # Deletar clínica
  node backend/exemplo-uso.js 8   # Fluxo de onboarding
  node backend/exemplo-uso.js 9   # Estados de acesso
  node backend/exemplo-uso.js 10  # Integração Express

Certifique-se de ter:
  ✅ .env configurado com credenciais
  ✅ Supabase schema.sql executado
  ✅ Evolution API acessível
  ✅ n8n webhook configurado
  ✅ Anthropic API key válida
  `);
}

module.exports = {
  exemplo1_criarClinica,
  exemplo2_obterDadosClinica,
  exemplo3_salvarDados,
  exemplo4_verificarStatus,
  exemplo5_enviarMensagemTeste,
  exemplo6_simularWebhookMensagem,
  exemplo7_deletarClinica,
  exemplo8_fluxoOnboarding,
};
