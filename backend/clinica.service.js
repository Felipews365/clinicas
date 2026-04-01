/**
 * Serviço de gerenciamento de clínicas multi-tenant
 * Responsável por criar instâncias da Evolution API e gerenciar dados
 */

const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Inicializar Supabase com SERVICE KEY (acesso admin)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const { resolveN8nWebhookUrl } = require('./config/n8n-webhook');

// ============================================================================
// FUNÇÃO: criarInstanciaClinica()
// Cria uma nova instância da Evolution API para uma clínica
// ============================================================================
async function criarInstanciaClinica(clinicaId) {
  console.log(`[criarInstanciaClinica] Iniciando criação para clínica: ${clinicaId}`);

  try {
    // 1. Validar que a clínica existe no Supabase
    const { data: clinicaData, error: clinicaError } = await supabase
      .from('clinicas')
      .select('*')
      .eq('id', clinicaId)
      .single();

    if (clinicaError || !clinicaData) {
      throw new Error(`Clínica não encontrada: ${clinicaId}`);
    }

    // 2. Gerar nome da instância no padrão: clinica-{uuid}
    const nomeInstancia = `clinica-${clinicaId.substring(0, 8).toLowerCase()}`;

    console.log(`[criarInstanciaClinica] Nome da instância: ${nomeInstancia}`);

    // 3. Chamar Evolution API para criar instância
    const instanciaResponse = await criarInstanciaEvolution(nomeInstancia);

    if (!instanciaResponse.instance) {
      throw new Error('Falha ao criar instância na Evolution API');
    }

    // 4. Configurar webhook na Evolution API
    await configurarWebhookEvolution(nomeInstancia);

    // 5. Salvar dados da instância no Supabase
    const { error: updateError } = await supabase
      .from('clinicas')
      .update({
        instancia_evolution: nomeInstancia,
        status_whatsapp: 'aguardando_qr',
        updated_at: new Date().toISOString(),
      })
      .eq('id', clinicaId);

    if (updateError) {
      throw new Error(`Erro ao atualizar clínica no Supabase: ${updateError.message}`);
    }

    console.log(`[criarInstanciaClinica] Instância salva no Supabase`);

    // 6. Buscar e retornar QR Code
    const qrCode = await buscarQRCodeEvolution(nomeInstancia);

    return {
      sucesso: true,
      clinicaId,
      nomeInstancia,
      statusWhatsapp: 'aguardando_qr',
      qrCode: qrCode || null,
      mensagem: 'Instância criada com sucesso. Escaneie o QR Code para conectar.',
    };
  } catch (erro) {
    console.error(`[criarInstanciaClinica] Erro: ${erro.message}`);
    throw erro;
  }
}

// ============================================================================
// FUNÇÃO: criarInstanciaEvolution()
// Chama API da Evolution para criar uma nova instância
// ============================================================================
async function criarInstanciaEvolution(nomeInstancia) {
  try {
    const response = await axios.post(
      `${EVOLUTION_API_URL}/instance/create`,
      {
        instanceName: nomeInstancia,
        integration: 'WHATSAPP-BAILEYS',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_API_KEY,
        },
      }
    );

    console.log(`[criarInstanciaEvolution] Instância criada: ${nomeInstancia}`);
    return response.data;
  } catch (erro) {
    console.error(
      `[criarInstanciaEvolution] Erro ao chamar Evolution API: ${erro.message}`
    );
    throw erro;
  }
}

// ============================================================================
// FUNÇÃO: configurarWebhookEvolution()
// Configura webhooks da instância para receber eventos do n8n
// ============================================================================
async function configurarWebhookEvolution(nomeInstancia) {
  try {
    const webhookUrl = resolveN8nWebhookUrl();

    // Configurar webhooks para os eventos que nos interessam
    const eventos = [
      'MESSAGES_UPSERT',     // Mensagens recebidas/enviadas
      'CONNECTION_UPDATE',   // Status da conexão WhatsApp
    ];

    for (const evento of eventos) {
      await axios.post(
        `${EVOLUTION_API_URL}/webhook/set`,
        {
          instanceName: nomeInstancia,
          webhook: webhookUrl,
          events: [evento],
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'apikey': EVOLUTION_API_KEY,
          },
        }
      );

      console.log(`[configurarWebhookEvolution] Webhook ${evento} configurado para ${nomeInstancia}`);
    }
  } catch (erro) {
    console.error(
      `[configurarWebhookEvolution] Erro ao configurar webhook: ${erro.message}`
    );
    // Não lançar erro aqui - deixar a instância ser criada mesmo com falha no webhook
    // Webhook pode ser reconfigurado depois
  }
}

// ============================================================================
// FUNÇÃO: buscarQRCodeEvolution()
// Obtém o QR Code da instância para escaneamento
// ============================================================================
async function buscarQRCodeEvolution(nomeInstancia) {
  try {
    // Tentar buscar QR Code - pode não estar pronto imediatamente
    const response = await axios.get(
      `${EVOLUTION_API_URL}/instance/fetchInstances`,
      {
        params: {
          instanceName: nomeInstancia,
        },
        headers: {
          'apikey': EVOLUTION_API_KEY,
        },
      }
    );

    const instancia = response.data.find(
      (inst) => inst.instanceName === nomeInstancia
    );

    if (instancia && instancia.qrcode) {
      console.log(`[buscarQRCodeEvolution] QR Code obtido para ${nomeInstancia}`);
      return instancia.qrcode;
    }

    console.log(`[buscarQRCodeEvolution] QR Code ainda não disponível para ${nomeInstancia}`);
    return null;
  } catch (erro) {
    console.error(
      `[buscarQRCodeEvolution] Erro ao buscar QR Code: ${erro.message}`
    );
    return null;
  }
}

// ============================================================================
// FUNÇÃO: obterStatusConexao()
// Obtém o status atual da conexão WhatsApp de uma instância
// ============================================================================
async function obterStatusConexao(nomeInstancia) {
  try {
    const response = await axios.get(
      `${EVOLUTION_API_URL}/instance/fetchInstances`,
      {
        params: {
          instanceName: nomeInstancia,
        },
        headers: {
          'apikey': EVOLUTION_API_KEY,
        },
      }
    );

    const instancia = response.data.find(
      (inst) => inst.instanceName === nomeInstancia
    );

    if (!instancia) {
      return null;
    }

    return {
      nomeInstancia: instancia.instanceName,
      estado: instancia.state, // 'open', 'connecting', 'close'
      telefone: instancia.phoneNumber || null,
      qrCode: instancia.qrcode || null,
    };
  } catch (erro) {
    console.error(
      `[obterStatusConexao] Erro ao buscar status: ${erro.message}`
    );
    return null;
  }
}

// ============================================================================
// FUNÇÃO: deletarInstanciaClinica()
// Remove uma instância quando a clínica é deletada
// ============================================================================
async function deletarInstanciaClinica(clinicaId, nomeInstancia) {
  try {
    // 1. Deletar instância na Evolution API
    await axios.delete(
      `${EVOLUTION_API_URL}/instance/delete`,
      {
        data: {
          instanceName: nomeInstancia,
        },
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_API_KEY,
        },
      }
    );

    console.log(`[deletarInstanciaClinica] Instância deletada na Evolution: ${nomeInstancia}`);

    // 2. Limpar dados no Supabase
    const { error } = await supabase
      .from('clinicas')
      .update({
        instancia_evolution: null,
        status_whatsapp: 'desconectado',
      })
      .eq('id', clinicaId);

    if (error) {
      console.error(`[deletarInstanciaClinica] Erro ao atualizar Supabase: ${error.message}`);
    }

    return { sucesso: true };
  } catch (erro) {
    console.error(
      `[deletarInstanciaClinica] Erro: ${erro.message}`
    );
    throw erro;
  }
}

// ============================================================================
// FUNÇÃO: enviarMensagemWhatsApp()
// Envia mensagem de texto via WhatsApp através da Evolution API
// ============================================================================
async function enviarMensagemWhatsApp(nomeInstancia, telefone, mensagem) {
  try {
    // Garantir que o telefone tem o formato correto (apenas números)
    const telefoneLimpo = telefone.replace(/\D/g, '');

    const response = await axios.post(
      `${EVOLUTION_API_URL}/message/sendText/${nomeInstancia}`,
      {
        number: telefoneLimpo,
        text: mensagem,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_API_KEY,
        },
      }
    );

    console.log(`[enviarMensagemWhatsApp] Mensagem enviada para ${telefone}`);
    return {
      sucesso: true,
      messageId: response.data.messageId,
    };
  } catch (erro) {
    console.error(
      `[enviarMensagemWhatsApp] Erro ao enviar mensagem: ${erro.message}`
    );
    throw erro;
  }
}

// ============================================================================
// FUNÇÃO: obterDadosClinica()
// Busca todos os dados de uma clínica com seus dados customizados
// ============================================================================
async function obterDadosClinica(clinicaId) {
  try {
    // Buscar dados da clínica
    const { data: clinica, error: clinicaError } = await supabase
      .from('clinicas')
      .select('*')
      .eq('id', clinicaId)
      .single();

    if (clinicaError || !clinica) {
      throw new Error(`Clínica não encontrada: ${clinicaId}`);
    }

    // Buscar dados customizados
    const { data: dadosCustomizados, error: dadosError } = await supabase
      .from('dados_clinica')
      .select('chave, valor')
      .eq('clinica_id', clinicaId);

    if (dadosError) {
      throw new Error(`Erro ao buscar dados customizados: ${dadosError.message}`);
    }

    // Converter array de objetos em um objeto simples
    const dados = {};
    dadosCustomizados.forEach((item) => {
      dados[item.chave] = item.valor;
    });

    return {
      ...clinica,
      dados,
    };
  } catch (erro) {
    console.error(`[obterDadosClinica] Erro: ${erro.message}`);
    throw erro;
  }
}

// ============================================================================
// FUNÇÃO: salvarDadoClinica()
// Salva um dado customizado para uma clínica
// ============================================================================
async function salvarDadoClinica(clinicaId, chave, valor) {
  try {
    const { error } = await supabase
      .from('dados_clinica')
      .upsert(
        {
          clinica_id: clinicaId,
          chave,
          valor,
        },
        { onConflict: 'clinica_id,chave' }
      );

    if (error) {
      throw new Error(`Erro ao salvar dado: ${error.message}`);
    }

    console.log(`[salvarDadoClinica] Dados salvos: ${chave} = ${valor}`);
    return { sucesso: true };
  } catch (erro) {
    console.error(`[salvarDadoClinica] Erro: ${erro.message}`);
    throw erro;
  }
}

// ============================================================================
// Exportar funções
// ============================================================================
module.exports = {
  criarInstanciaClinica,
  deletarInstanciaClinica,
  enviarMensagemWhatsApp,
  obterDadosClinica,
  salvarDadoClinica,
  obterStatusConexao,
  buscarQRCodeEvolution,
};
