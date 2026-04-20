# CLAUDE.md — Consultório 2026

## Papel
Criar, manter e evoluir workflows n8n + banco de dados Supabase para o sistema de atendimento via WhatsApp de clínicas.

---

## Instâncias e acesso

| Serviço | URL |
|---|---|
| n8n Editor (UI) | https://editor.docker-script7.com.br |
| n8n API | https://n8n.vps7846.panel.icontainer.cloud/api/v1 |
| Supabase | Usar MCP `mcp__supabase__*` (projeto já configurado) |

- **n8n API Key**: guardada em memória (`reference_n8n_api.md`)
- Para subir workflow via API usar `PUT /api/v1/workflows/{id}` com payload contendo apenas `name`, `nodes`, `connections`, `settings.executionOrder`, `staticData`
- O workflow principal é o `kCX2LfxJrdYWB0vk` (`workflow-kCX2-live.json`)

---

## Estrutura do projeto

```
n8n/
  workflow-kCX2-live.json   ← workflow principal (sempre manter sincronizado com n8n)
supabase/
  migrations/               ← todas as migrations SQL versionadas
web/
  src/                      ← painel web (Next.js)
```

---

## Regras de desenvolvimento

### Workflow n8n
- O arquivo `workflow-kCX2-live.json` tem **dois blocos** de nodes: `nodes[]` (top-level) e `activeVersion.nodes[]` — ambos devem ser atualizados juntos
- Após editar o JSON local, sempre subir via API (não copiar/colar na UI)
- Para sincronizar local ← n8n (após editar na UI): `GET /api/v1/workflows/kCX2LfxJrdYWB0vk` e salvar em `workflow-kCX2-live.json`
- O node `AI Agent` (monolítico antigo) está **desconectado** no workflow — mantido apenas como rollback. Não editar nem reconectar sem intenção explícita

### Supabase / Banco
- Toda alteração de schema via `mcp__supabase__apply_migration` E criar arquivo `.sql` em `supabase/migrations/`
- Nomear migrations: `YYYYMMDDHHMMSS_descricao_snake_case.sql`
- RPCs usadas pelo agente n8n: prefixo `n8n_cs_*`

### Serviços (dual-source)
- O painel v2 salva procedimentos em `clinic_procedures` (campos: `id`, `name`, `clinic_id`)
- O legado usa `cs_servicos` (campos: `id`, `nome`, `clinic_id`)
- A RPC `n8n_cs_agendar` tenta `clinic_procedures` primeiro; se não achar, tenta `cs_servicos`
- Quando o serviço vem de `clinic_procedures`, `cs_agendamentos.servico_id` fica **NULL** (sem FK entre as tabelas) — o nome é preservado em `nome_procedimento`
- `cs_agendamentos.servico_id` é **nullable** por design — não adicionar NOT NULL nessa coluna

### Multi-tenant (SaaS)
- Cada clínica é um **tenant** isolado identificado por `clinic_id` (UUID)
- A clínica é resolvida a partir do `instance_name` da Evolution API → tabela `clinics`
- **Toda query ao banco DEVE incluir `clinic_id`** para garantir isolamento entre clínicas
- Cada clínica tem sua própria configuração em `clinics.agent_instructions` (JSON):
  - `nome_agente`: nome do assistente virtual da clínica
  - `saudacao_novo`: template de boas-vindas para cliente novo (suporta `{{name}}`, `{{clinica}}`, `{{periodo}}`)
  - `saudacao_retorno`: template de boas-vindas para cliente de retorno (suporta `{{nome_cliente}}`)
  - `identidade`: quem é o agente e como se apresenta
  - `triagem`: regras de triagem e urgências — salvo como lista `- item\n- item`
  - `tom`: tom e linguagem — salvo como `✅ USAR SEMPRE:\n- item\n\n❌ NUNCA FAZER:\n- item` (NÃO editar como texto livre; gerado pelo painel)
  - `orientacoes`: orientações ao paciente — salvo como lista `- item\n- item`
  - `transferir`: quando transferir para humano — salvo como lista `- item\n- item`
  - ~~`outros`~~: campo removido do painel (dados legados no banco podem ainda existir mas não são exibidos)
- `cs_clientes`, `cs_agendamentos`, slots, serviços, profissionais — tudo filtrado por `clinic_id`
- Ao criar RPCs novas, sempre receber `p_clinic_id uuid` como primeiro parâmetro

### Agente WhatsApp (fluxo resumido)
1. Webhook recebe mensagem → `Campos iniciais` extrai dados
2. `Code merge webhook e resolucao` resolve `clinica_id` pelo `instance_name`
3. `Get Empresa` busca dados da clínica (incluindo `agent_instructions`)
4. `Get Cliente` busca cliente por `clinic_id` + `telefone`
5. `Verificar se cliente está cadastrado`: se não existe → `Create Cliente` com `nome = ''`
6. `Bot inativo` verifica se atendimento humano assumiu
7. Fila Redis (debounce 6s) agrupa mensagens rápidas
8. `Monta Contexto` monta payload para os agentes:
   - injeta `clinic_name`, `nome_agente`, `agent_instructions`, `saudacao_novo/retorno`
   - injeta `clinic_id`, `remoteJid`, `instanceName` (usados pelos agentes e handoff)
   - injeta `instr_triagem`, `instr_faq`, `instr_transferir` (seções de `agent_instructions`)
   - `instr_outros` ainda pode existir no Code node por compatibilidade com dados legados, mas não é alimentado pelo painel
   - `nome_cliente` vazio = cliente novo → agente qualificador pergunta o nome
   - `nome_cliente` preenchido = cliente de retorno → agente qualificador saúda pelo nome
9. **Sistema multi-agente** roteia para o agente especializado correto (ver seção abaixo)
10. Resposta enviada via Evolution API (WhatsApp)

### Arquitetura Multi-Agente

O fluxo de IA usa **4 agentes especializados + 1 handoff determinístico** para reduzir alucinação:

```
Monta Contexto
  → agente_atende_qualifica  (temp 0.4) — saudação, coleta nome, classifica intenção
  → Code Extrair Rota        — extrai tag [ROTA: X] e repassa contexto completo
  → Switch Rota
       agendamento   → agente_agendador               (temp 0.1)
       faq           → agente_faq                     (temp 0.5)
       procedimentos → agente_especialista_procedimentos (temp 0.4)
       humano        → Code Preparar Handoff → Update bot_ativo=false → Evolution send
       concluido     → Edit Fields (resposta direta do qualificador)
  → Edit Fields → dispatch WhatsApp
```

Todos os agentes compartilham a mesma **Postgres Chat Memory** (session: `clinic_id:remoteJid`, 50 msgs).

### Tools por Agente

| Tool (node n8n) | Agente | RPC / Destino |
|---|---|---|
| `qualifica_cs_salvar_nome` | qualifica | `n8n_cs_salvar_nome` — salva nome confirmado |
| `agd_cs_consultar_servicos` | agendador | `n8n_clinic_procedimentos` — lista procedimentos |
| `agd_cs_consultar_profissionais` | agendador | `cs_profissionais` — lista profissionais |
| `agd_cs_consultar_vagas` | agendador | `n8n_cs_consultar_vagas` — horários disponíveis |
| `agd_cs_agendar` | agendador | `n8n_cs_agendar` — cria agendamento |
| `agd_cs_buscar_agendamentos` | agendador | `n8n_cs_buscar_agendamentos` — consulta agendamentos |
| `agd_cs_reagendar` | agendador | `n8n_cs_reagendar` — reagenda |
| `agd_cs_cancelar` | agendador | `n8n_cs_cancelar` — cancela |
| `agd_cs_notificar_profissional` | agendador | Evolution API — envia WhatsApp ao profissional |
| `faq_cs_consultar_servicos` | faq | `n8n_clinic_procedimentos` — lista serviços |
| `esp_cs_consultar_servicos` | especialista | `n8n_clinic_procedimentos` — detalhes do procedimento |

> Cada agente tem também um **Refletir** (Think tool) para raciocínio antes de responder.
> Os nodes `agd_*`, `faq_*`, `esp_*` são cópias independentes — não compartilhar entre agentes.

### Notificação de profissionais
- Após `cs_agendar`, `cs_reagendar` ou `cs_cancelar`, o agente chama `cs_notificar_profissional` se `profissional_whatsapp` não for nulo
- O `profissional_whatsapp` vem das RPCs via `LEFT JOIN professionals ON cs_profissional_id = cs_profissionais.id`
- O campo `professionals.whatsapp` é cadastrado no painel web (componente `professionals-manager-modal.tsx`)
- Se o profissional não tiver WhatsApp cadastrado, `profissional_whatsapp` retorna `null` e a notificação é pulada silenciosamente
- O tool `cs_notificar_profissional` usa a mesma `instanceName` da clínica (Evolution API)

### Identificação de cliente novo vs retorno
- `cs_clientes.nome` = vazio (`''`) → nunca confirmou o nome → **cliente novo**
- `cs_clientes.nome` = preenchido → nome confirmado via `cs_salvar_nome` → **cliente de retorno**
- `Create Cliente` sempre cria com `nome = ''` (DEFAULT `''` no banco)
- NÃO salvar `pushName` do WhatsApp como nome — é nome do WhatsApp, não confirmado
