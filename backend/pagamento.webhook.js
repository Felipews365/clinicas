/**
 * Webhook para receber eventos de pagamento do Asaas
 * Integra com Supabase para reativar/bloquear clínicas
 */

const { createClient } = require('@supabase/supabase-js');
const express = require('express');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const router = express.Router();

// ============================================================================
// WEBHOOK: POST /webhooks/asaas
// Recebe eventos de pagamento do Asaas
// ============================================================================
router.post('/asaas', async (req, res) => {
  console.log('[Pagamento Webhook] Evento recebido do Asaas');

  try {
    const evento = req.body;

    // Validar que o evento tem os campos esperados
    if (!evento.event || !evento.payment) {
      console.warn('[Pagamento Webhook] Evento inválido - faltam campos obrigatórios');
      return res.status(400).json({
        erro: 'Evento inválido - faltam campos obrigatórios',
      });
    }

    console.log(`[Pagamento Webhook] Tipo de evento: ${evento.event}`);

    // Distribuir por tipo de evento
    switch (evento.event) {
      case 'PAYMENT_CONFIRMED':
        await handlePagamentoConfirmado(evento);
        break;

      case 'PAYMENT_OVERDUE':
        await handlePagamentoVencido(evento);
        break;

      case 'PAYMENT_DELETED':
        await handlePagamentoCancelado(evento);
        break;

      default:
        console.log(`[Pagamento Webhook] Evento ignorado: ${evento.event}`);
    }

    // Responder com 200 para o Asaas confirmar recebimento
    res.status(200).json({
      sucesso: true,
      mensagem: 'Webhook processado',
    });
  } catch (erro) {
    console.error(`[Pagamento Webhook] Erro ao processar evento: ${erro.message}`);
    res.status(500).json({
      erro: 'Erro ao processar webhook',
      mensagem: erro.message,
    });
  }
});

// ============================================================================
// HANDLER: PAYMENT_CONFIRMED
// Ativa/reativa a clínica após pagamento confirmado
// ============================================================================
async function handlePagamentoConfirmado(evento) {
  const payment = evento.payment;

  try {
    console.log(
      `[handlePagamentoConfirmado] Pagamento confirmado: ${payment.id}`
    );

    // 1. Extrair clinica_id da referência do pagamento
    // Esperado formato: "clinica-{clinica_id}"
    const clinicaId = extrairClinicaIdDaReferencia(payment.externalReference);

    if (!clinicaId) {
      console.warn(
        `[handlePagamentoConfirmado] Não foi possível extrair clinica_id da referência: ${payment.externalReference}`
      );
      return;
    }

    // 2. Registrar pagamento no histórico
    await registrarPagamento(
      clinicaId,
      payment.value,
      'PAYMENT_CONFIRMED',
      payment.id,
      new Date(payment.confirmedDate).toISOString()
    );

    // 3. Reativar clínica (chamar função SQL)
    // Usar 30 dias como padrão para renovação mensal
    const diasRenovacao = calcularDiasRenovacao(payment.value);

    const { error } = await supabase.rpc('reativar_clinica', {
      p_clinica_id: clinicaId,
      p_dias: diasRenovacao,
    });

    if (error) {
      throw new Error(`Erro ao chamar reativar_clinica: ${error.message}`);
    }

    console.log(
      `[handlePagamentoConfirmado] Clínica ${clinicaId} reativada por ${diasRenovacao} dias`
    );

    // 4. Buscar e enviar notificação para a clínica (opcional)
    await notificarClinicaPagamentoConfirmado(clinicaId, payment.value);
  } catch (erro) {
    console.error(
      `[handlePagamentoConfirmado] Erro: ${erro.message}`
    );
  }
}

// ============================================================================
// HANDLER: PAYMENT_OVERDUE
// Apenas registra pagamento vencido - bloqueio ocorre no CRON diário
// ============================================================================
async function handlePagamentoVencido(evento) {
  const payment = evento.payment;

  try {
    console.log(`[handlePagamentoVencido] Pagamento vencido: ${payment.id}`);

    const clinicaId = extrairClinicaIdDaReferencia(payment.externalReference);

    if (!clinicaId) {
      return;
    }

    // Registrar apenas - bloqueio acontece no CRON
    await registrarPagamento(
      clinicaId,
      payment.value,
      'PAYMENT_OVERDUE',
      payment.id,
      null // pago_em fica NULL pois não foi pago
    );

    console.log(
      `[handlePagamentoVencido] Pagamento vencido registrado para clínica ${clinicaId}`
    );

    // Notificar clínica sobre vencimento
    await notificarClinicaPagamentoVencido(clinicaId, payment.dueDate);
  } catch (erro) {
    console.error(`[handlePagamentoVencido] Erro: ${erro.message}`);
  }
}

// ============================================================================
// HANDLER: PAYMENT_DELETED
// Registra cancelamento de pagamento
// ============================================================================
async function handlePagamentoCancelado(evento) {
  const payment = evento.payment;

  try {
    console.log(`[handlePagamentoCancelado] Pagamento cancelado: ${payment.id}`);

    const clinicaId = extrairClinicaIdDaReferencia(payment.externalReference);

    if (!clinicaId) {
      return;
    }

    await registrarPagamento(
      clinicaId,
      payment.value,
      'PAYMENT_DELETED',
      payment.id,
      null
    );

    console.log(
      `[handlePagamentoCancelado] Cancelamento registrado para clínica ${clinicaId}`
    );
  } catch (erro) {
    console.error(`[handlePagamentoCancelado] Erro: ${erro.message}`);
  }
}

// ============================================================================
// FUNÇÃO: registrarPagamento()
// Insere registro na tabela historico_pagamentos
// ============================================================================
async function registrarPagamento(clinicaId, valor, status, referencia, pagoEm) {
  try {
    const { error } = await supabase.from('historico_pagamentos').insert({
      clinica_id: clinicaId,
      valor,
      status,
      referencia,
      pago_em: pagoEm,
    });

    if (error) {
      throw new Error(`Erro ao registrar pagamento: ${error.message}`);
    }

    console.log(
      `[registrarPagamento] Pagamento registrado - Clínica: ${clinicaId}, Status: ${status}`
    );
  } catch (erro) {
    console.error(`[registrarPagamento] Erro: ${erro.message}`);
    throw erro;
  }
}

// ============================================================================
// FUNÇÃO AUXILIAR: extrairClinicaIdDaReferencia()
// Extrai clinica_id da referência externa do pagamento
// Formato esperado: "clinica-{clinica_id}" ou similar
// ============================================================================
function extrairClinicaIdDaReferencia(referencia) {
  if (!referencia) {
    return null;
  }

  // Tentar extrair UUID da referência
  // Padrão: "clinica-123e4567-e89b-12d3-a456-426614174000" ou similar
  const match = referencia.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);

  if (match) {
    return match[1];
  }

  // Se não encontrar UUID, tentar campo customizado da clínica
  // Isso pode variar de acordo com a implementação
  return null;
}

// ============================================================================
// FUNÇÃO AUXILIAR: calcularDiasRenovacao()
// Retorna quantos dias adicionar baseado no valor pago
// Pode ser customizado por plano
// ============================================================================
function calcularDiasRenovacao(valor) {
  // Exemplo simples: cada R$100 = 30 dias
  // Ajustar conforme necessário
  const diasPorCem = 30;
  const dias = Math.floor((valor / 100) * diasPorCem);

  return Math.max(dias, 30); // Mínimo de 30 dias
}

// ============================================================================
// FUNÇÃO AUXILIAR: notificarClinicaPagamentoConfirmado()
// Envia notificação de pagamento confirmado para a clínica
// ============================================================================
async function notificarClinicaPagamentoConfirmado(clinicaId, valor) {
  try {
    // TODO: Implementar notificação
    // Pode ser email, SMS, mensagem WhatsApp, etc.

    console.log(
      `[notificarClinicaPagamentoConfirmado] Notificação: Clínica ${clinicaId} - Pagamento de R$ ${valor} confirmado`
    );
  } catch (erro) {
    console.error(`[notificarClinicaPagamentoConfirmado] Erro: ${erro.message}`);
    // Não lançar erro aqui - notificação é secundária
  }
}

// ============================================================================
// FUNÇÃO AUXILIAR: notificarClinicaPagamentoVencido()
// Envia notificação de pagamento vencido
// ============================================================================
async function notificarClinicaPagamentoVencido(clinicaId, dataVencimento) {
  try {
    // TODO: Implementar notificação

    console.log(
      `[notificarClinicaPagamentoVencido] Notificação: Clínica ${clinicaId} - Pagamento vencido em ${dataVencimento}`
    );
  } catch (erro) {
    console.error(`[notificarClinicaPagamentoVencido] Erro: ${erro.message}`);
  }
}

module.exports = router;
