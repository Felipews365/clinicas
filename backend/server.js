/**
 * Servidor Express - Backend Sistema Multi-Tenant WhatsApp
 * Gerencia clínicas, instâncias e webhooks de pagamento
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const pagamentoWebhook = require('./pagamento.webhook');
const whatsappRoutes = require('./whatsapp.routes');
const { criarInstanciaClinica, obterDadosClinica } = require('./clinica.service');

const app = express();

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Segurança
app.use(helmet());

// CORS
const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
if (process.env.FRONTEND_URL) {
  allowedOrigins.add(process.env.FRONTEND_URL);
}
app.use(
  cors({
    origin(origin, callback) {
      // Permite chamadas server-to-server e ferramentas sem origin
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error(`Origin não permitida pelo CORS: ${origin}`));
    },
    credentials: true,
  })
);

// Parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// ROTAS PÚBLICAS (sem autenticação)
// ============================================================================

/**
 * Health Check
 * GET /health
 */
app.get('/health', (req, res) => {
  const port = Number(process.env.PORT || 3001);
  res.json({
    ok: true,
    service: 'backend',
    port,
  });
});

/**
 * Status da API
 * GET /status
 */
app.get('/status', (req, res) => {
  res.json({
    api: 'online',
    supabase: process.env.SUPABASE_URL ? 'configured' : 'not configured',
    evolution: process.env.EVOLUTION_API_URL ? 'configured' : 'not configured',
    anthropic: process.env.ANTHROPIC_API_KEY ? 'configured' : 'not configured',
    evolutionWebhook: process.env.EVOLUTION_WEBHOOK_URL ? 'configured' : 'not configured',
  });
});

// ============================================================================
// ROTAS DE WEBHOOKS (públicas)
// ============================================================================

/**
 * Webhooks
 * POST /webhooks/asaas - Eventos de pagamento
 */
app.use('/webhooks', pagamentoWebhook);

// Rotas de conexão WhatsApp e webhooks Evolution
// POST /api/whatsapp/connect
// GET  /api/whatsapp/status
// POST /api/webhooks/evolution
// Compatibilidade:
// POST /api/clinica/:id/conectar-whatsapp
// GET  /api/clinica/:id/status-whatsapp
app.use('/api', whatsappRoutes);

// ============================================================================
// ROTAS PROTEGIDAS (com autenticação)
// ============================================================================

// Middleware de autenticação (exemplo básico - substituir com JWT real)
const autenticar = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      erro: 'Token de autenticação necessário',
      mensagem: 'Use: Authorization: Bearer SEU_TOKEN',
    });
  }

  // TODO: Implementar verificação real de JWT
  // Por enquanto, apenas verificar que tem token
  req.user = { id: 'user-dummy', clinicaId: 'clinica-dummy' };
  next();
};

/**
 * Criar nova clínica
 * POST /api/clinicas
 * Body: { nome, promptAgente, plano }
 */
app.post('/api/clinicas', autenticar, async (req, res) => {
  try {
    console.log('[POST /api/clinicas] Criando nova clínica');

    const { nome, promptAgente, plano } = req.body;

    // Validações básicas
    if (!nome || !promptAgente) {
      return res.status(400).json({
        erro: 'Campos obrigatórios: nome, promptAgente',
      });
    }

    // TODO: Criar clínica no banco (implementar com seu método)
    // Por enquanto, simular resposta
    const clinicaId = 'clinica-' + Math.random().toString(36).substring(7);

    // Criar instância na Evolution
    const resultado = await criarInstanciaClinica(clinicaId);

    return res.status(201).json({
      sucesso: true,
      clinicaId,
      mensagem: 'Clínica criada com sucesso',
      dados: resultado,
    });
  } catch (erro) {
    console.error('[POST /api/clinicas] Erro:', erro.message);
    res.status(500).json({
      erro: 'Erro ao criar clínica',
      mensagem: erro.message,
    });
  }
});

/**
 * Obter dados de uma clínica
 * GET /api/clinicas/:clinicaId
 */
app.get('/api/clinicas/:clinicaId', autenticar, async (req, res) => {
  try {
    const { clinicaId } = req.params;

    // TODO: Validar que o usuário tem acesso a esta clínica
    // if (req.user.clinicaId !== clinicaId) {
    //   return res.status(403).json({ erro: 'Acesso negado' });
    // }

    const dados = await obterDadosClinica(clinicaId);

    return res.json({
      sucesso: true,
      dados,
    });
  } catch (erro) {
    console.error('[GET /api/clinicas/:id] Erro:', erro.message);
    res.status(500).json({
      erro: 'Erro ao obter dados da clínica',
      mensagem: erro.message,
    });
  }
});

/**
 * Listar clínicas do usuário
 * GET /api/clinicas
 */
app.get('/api/clinicas', autenticar, async (req, res) => {
  try {
    console.log('[GET /api/clinicas] Listando clínicas do usuário');

    // TODO: Implementar busca das clínicas do usuário do banco
    // Por enquanto, resposta dummy
    res.json({
      sucesso: true,
      clinicas: [
        {
          id: 'clinica-1',
          nome: 'Clínica Exemplo',
          status_acesso: 'liberado',
        },
      ],
    });
  } catch (erro) {
    console.error('[GET /api/clinicas] Erro:', erro.message);
    res.status(500).json({
      erro: 'Erro ao listar clínicas',
      mensagem: erro.message,
    });
  }
});

/**
 * Atualizar dados da clínica
 * PUT /api/clinicas/:clinicaId
 */
app.put('/api/clinicas/:clinicaId', autenticar, async (req, res) => {
  try {
    const { clinicaId } = req.params;
    const { nome, promptAgente } = req.body;

    console.log(`[PUT /api/clinicas/${clinicaId}] Atualizando...`);

    // TODO: Validar acesso e atualizar no banco

    return res.json({
      sucesso: true,
      mensagem: 'Clínica atualizada com sucesso',
    });
  } catch (erro) {
    console.error('[PUT /api/clinicas/:id] Erro:', erro.message);
    res.status(500).json({
      erro: 'Erro ao atualizar clínica',
      mensagem: erro.message,
    });
  }
});

/**
 * Deletar clínica
 * DELETE /api/clinicas/:clinicaId
 */
app.delete('/api/clinicas/:clinicaId', autenticar, async (req, res) => {
  try {
    const { clinicaId } = req.params;

    console.log(`[DELETE /api/clinicas/${clinicaId}] Deletando...`);

    // TODO: Validar acesso e deletar

    return res.json({
      sucesso: true,
      mensagem: 'Clínica deletada com sucesso',
    });
  } catch (erro) {
    console.error('[DELETE /api/clinicas/:id] Erro:', erro.message);
    res.status(500).json({
      erro: 'Erro ao deletar clínica',
      mensagem: erro.message,
    });
  }
});

/**
 * Obter QR Code de escaneamento
 * GET /api/clinicas/:clinicaId/qrcode
 */
app.get('/api/clinicas/:clinicaId/qrcode', autenticar, async (req, res) => {
  try {
    const { clinicaId } = req.params;

    console.log(`[GET /api/clinicas/${clinicaId}/qrcode] Obtendo QR Code...`);

    // TODO: Buscar instância da clínica e obter QR code
    // const dados = await obterDadosClinica(clinicaId);
    // const qrCode = await buscarQRCodeEvolution(dados.instancia_evolution);

    return res.json({
      sucesso: true,
      qrCode: 'data:image/png;base64,...',
    });
  } catch (erro) {
    console.error('[GET /api/clinicas/:id/qrcode] Erro:', erro.message);
    res.status(500).json({
      erro: 'Erro ao obter QR code',
      mensagem: erro.message,
    });
  }
});

// ============================================================================
// TRATAMENTO DE ERROS
// ============================================================================

/**
 * 404 - Rota não encontrada
 */
app.use((req, res) => {
  res.status(404).json({
    erro: 'Rota não encontrada',
    path: req.path,
    method: req.method,
  });
});

/**
 * Error Handler
 */
app.use((err, req, res, next) => {
  console.error('[Error Handler]', err);

  res.status(err.status || 500).json({
    erro: 'Erro interno do servidor',
    mensagem: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║   Sistema Multi-Tenant WhatsApp - Backend              ║
╚════════════════════════════════════════════════════════╝

🚀 Servidor iniciado com sucesso!

📍 URL: http://localhost:${PORT}
🔧 Ambiente: ${NODE_ENV}
⏰ Timestamp: ${new Date().toISOString()}

📚 Endpoints disponíveis:
  GET  /health               - Health check
  GET  /status               - Status da API

  POST   /api/clinicas       - Criar clínica
  GET    /api/clinicas       - Listar clínicas
  GET    /api/clinicas/:id   - Obter dados
  PUT    /api/clinicas/:id   - Atualizar
  DELETE /api/clinicas/:id   - Deletar
  GET    /api/clinicas/:id/qrcode - QR Code

  POST   /api/whatsapp/connect - Conectar ou reutilizar instância WhatsApp
  GET    /api/whatsapp/status  - Status atual da instância WhatsApp
  POST   /api/webhooks/evolution - Webhook de eventos da Evolution
  POST   /webhooks/asaas        - Webhook de pagamentos

⚙️  Verificar variáveis em .env:
  ✓ EVOLUTION_API_URL
  ✓ SUPABASE_URL
  ✓ ANTHROPIC_API_KEY
  ✓ EVOLUTION_WEBHOOK_URL

📖 Documentação: IMPLEMENTACAO.md
🧪 Testes: backend/exemplo-uso.js
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM recebido. Encerrando servidor...');
  server.close(() => {
    console.log('Servidor encerrado.');
    process.exit(0);
  });
});

module.exports = app;
