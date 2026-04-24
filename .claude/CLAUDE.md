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

### Profissionais (dual-table com sync automático)
- O painel v2 salva profissionais em `professionals` (campos: `id`, `name`, `specialty`, `whatsapp`, **`gender`** (`M`/`F` → Dr./Dra. nas mensagens WhatsApp ao profissional; migration `20260427200000_professionals_gender_dr_dra.sql`), `is_active`, `clinic_id`, `cs_profissional_id`, ...)
- O legado/n8n usa `cs_profissionais` (campos: `id`, `nome`, `especialidade`, `ativo`, `clinic_id`, espelho **`gender`**)
- **Trigger `trg_sync_professional_to_cs`** sincroniza automaticamente `professionals` → `cs_profissionais` no INSERT e UPDATE
  - INSERT cria nova linha em `cs_profissionais` e preenche `professionals.cs_profissional_id`
  - UPDATE (quando `cs_profissional_id` não é null) atualiza `nome`, `especialidade`, **`gender`** e `ativo`
- Tabela **`professional_procedures`** (migration `20260427100000_professional_procedures.sql`): N:N entre `professionals` e `clinic_procedures` — filtra «tipo de consulta» no agendamento do painel; vazio = todos os procedimentos ativos
- **Compat. BD antiga:** `web/src/lib/supabase-gender-column-fallback.ts` (reads sem `gender` se coluna em falta); `web/src/lib/supabase-schema-cache-errors.ts` (ignora sync de vínculos se tabela `professional_procedures` não existir); writes no painel repetem sem `gender`/`professional_procedures` quando o PostgREST devolve erro de schema
- A agenda (`painel_cs_slots_dia`, `painel_cs_ensure_slots_grid`) e as RPCs do agente usam `cs_profissionais` — **nunca editar essas funções para ler de `professionals` diretamente**
- O campo `professionals.cs_profissional_id` é a FK que liga as duas tabelas; se for null, o profissional não aparece na agenda nem no agente
- Ao reportar problemas de profissional não aparecer na agenda, verificar se `cs_profissional_id` está preenchido na tabela `professionals`
- **Órfãos em `cs_profissionais`:** apagar um profissional no painel não remove a linha em `cs_profissionais`; duplicados ou renames antigos podem deixar vários `cs_profissionais.ativo = true` para a mesma clínica. A RPC continua a devolver todos; o contador «Profissionais activos» usa só `professionals` activos.
- **Painel web — `web/src/components/slots-manager-modal.tsx`:** depois de `painel_cs_slots_dia`, o UI filtra os slots para `profissional_id` ∈ `cs_profissional_id` de linhas **activas** em `professionals` (fallback por nome normalizado só se `cs_profissional_id` for null no painel). Em seguida **merge** de linhas `appointments` (`status = scheduled`, mesmo dia): a RPC só reflecte `cs_*`; marcações feitas só no painel apareciam só no dashboard — o merge marca a célula como ocupada («Agend.») com o procedimento. Limpeza definitiva de órfãos ainda pode ser feita na BD (`cs_profissionais` / horários ligados).
- **Painel web — `web/src/components/agenda-portal.tsx`:** cancelar agendamento (ícone lixeira) → **modal** próprio com checkbox «Confirmo…» antes de «Sim, cancelar» (sem `window.confirm`). Data no dashboard: **`AgendaDatePickerPopover`** (calendário mensal em vez de só `<input type="date">`).

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
3. `Buscar Config Cl?nica` (HTTP Request → Supabase REST) busca dados da clínica (incluindo `agent_instructions`)
   - **Atenção:** o nome real do node no n8n contém `?` literal (encoding corrompido de `í`). Sempre referenciar como `$('Buscar Config Cl?nica')` em Code nodes
   - `Get Empresa` (Supabase node) existe no workflow mas está em outro ramo — **não** é o que alimenta o Monta Contexto
4. `Check First Contact` (Postgres) conta histórico de chat para detectar primeiro contato
5. `Get Cliente` busca cliente por `clinic_id` + `telefone`
6. `Verificar se cliente está cadastrado`: se não existe → `Create Cliente` com `nome = ''`
7. `Bot inativo` verifica se atendimento humano assumiu
8. Fila Redis — fluxo linear: `RegistraMsgFila` → `BuscaMensagens` → `Aguarda 13 segundos` → `VerificaMensagens` (GET) → `OrganizaMensagem` → `ResetaFila`. `keyType: list` nos GETs. Push: `JSON.stringify(Object.assign({}, JSON.parse(JSON.stringify($json)), { wppKeyId }))` (não usar `...$json` no expression — n8n 2.x / Redis `lPush` exige string). `OrganizaMensagem` deduplica.
9. `Monta Contexto` (Code node) monta payload para os agentes:
   - lê dados da clínica via `$('Buscar Config Cl?nica').first().json` (não via `$input`)
   - injeta `clinic_name`, `nome_agente`, `agent_instructions`, `saudacao_novo/retorno`
   - substitui placeholders `{{name}}`, `{{clinica}}`, `{{periodo}}` em `saudacao_novo` e `agent_instructions`
   - injeta `clinic_id`, `remoteJid`, `instanceName` (usados pelos agentes e handoff)
   - injeta `instr_triagem`, `instr_faq`, `instr_transferir` (seções de `agent_instructions`)
   - `instr_outros` ainda pode existir no Code node por compatibilidade com dados legados, mas não é alimentado pelo painel
   - `nome_cliente` vazio = cliente novo → agente qualificador pergunta o nome
   - `nome_cliente` preenchido = cliente de retorno → agente qualificador saúda pelo nome
10. **Sistema multi-agente** roteia para o agente especializado correto (ver seção abaixo)
11. Resposta enviada via Evolution API (WhatsApp)

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

#### Code Extrair Rota — comportamento de fallback
- Quando o qualificador **não inclui `[ROTA: X]`** na resposta (falha ocasional do LLM), o node infere a rota por palavras-chave no output:
  - palavras de agendamento (`verificar`, `horario`, `vagas`, `agendar`, `disponivel`, `momento`) → `agendamento`
  - palavras de explicação (`procedimento`, `funciona`, `preparo`, `tratamento`) → `procedimentos`
  - palavras de informação (`endereco`, `funcionamento`, `convenio`, `pagamento`, `pix`) → `faq`
  - caso contrário → `concluido`
- O padrão anterior era defaultar sempre para `concluido`, o que fazia o agendador nunca ser chamado quando a tag faltava

#### Regra do qualificador (`agente_atende_qualifica`)
- O qualificador **NÃO deve dizer** "Vou verificar", "Um momento", "Aguarde" ou qualquer frase que implique que ele fará algo — essas ações são dos agentes especializados
- Resposta correta: confirmar a intenção brevemente e incluir a tag — ex: `"Certo! [ROTA: agendamento]"`
- Se o qualificador disser "Vou verificar" sem a tag → o `Code Extrair Rota` vai inferir `agendamento` pelo fallback (comportamento correto), mas a resposta enviada ao cliente será esse "Vou verificar..." em vez do resultado do agendador — experiência ruim mas funcional

### Agendar vs reagendar (duplicados na grade)
- Se o cliente **já** tem consulta activa com o **mesmo** profissional na **mesma** data, `n8n_cs_agendar` responde `ok: false`, `error: ja_existe_agendamento_mesmo_dia` e devolve `agendamento_id` — usar **`n8n_cs_reagendar`** com esse id. Chamar `cs_agendar` de novo cria um **segundo** `cs_agendamentos` e o painel mostra dois horários «AGEND.».
- `n8n_cs_reagendar` liberta o slot antigo com `date_trunc('minute', horario)` e cancela duplicados órfãos no slot antigo após mover o registo principal.

### Tools por Agente

| Tool (node n8n) | Agente | RPC / Destino |
|---|---|---|
| `qualifica_cs_salvar_nome` | qualifica | `n8n_cs_salvar_nome` — salva nome confirmado |
| `agd_cs_consultar_servicos` | agendador | `n8n_clinic_procedimentos` — lista procedimentos |
| `agd_cs_consultar_profissionais` | agendador | `cs_profissionais` — lista profissionais |
| `agd_cs_consultar_vagas` | agendador | `n8n_cs_consultar_vagas` — só placeholder `data_solicitada`; `jsonBody` em string concatenada com `{data_solicitada}` (não `JSON.stringify`+`profissional_id` — n8n 2.10 «Misconfigured placeholder»); `p_profissional_id` sempre `null` (RPC lista todos) |
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
- O workflow tem **Code auto-notify profissional** (após o agendador): chama `n8n_cs_profissional_whatsapp_mudanca_recente` quando a resposta parece mutação; usa só dígitos no telefone; janela de «mudança recente» **45 min** no Supabase. O texto inclui **telefone do cliente** quando obtido via `cs_agendamentos.cliente_id` → `cs_clientes.telefone` (GET no Code node).
- Após `cs_agendar`, `cs_reagendar` ou `cs_cancelar`, o agente chama `cs_notificar_profissional` se `profissional_whatsapp` não for nulo
- O `profissional_whatsapp` vem das RPCs via `LEFT JOIN professionals ON cs_profissional_id = cs_profissionais.id`
- O campo `professionals.whatsapp` é cadastrado no painel web (componente `professionals-manager-modal.tsx`)
- Se o profissional não tiver WhatsApp cadastrado, `profissional_whatsapp` retorna `null` e a notificação é pulada silenciosamente
- O tool `cs_notificar_profissional` usa a mesma `instanceName` da clínica (Evolution API)
- **Painel Next.js (Evolution):** `web/src/lib/professional-notify-message.ts` formata novo / reagendar / cancelar com linha **📱 Telefone** do cliente quando `clienteTelefone` / `patients.phone` / RPC `painel_cancel_cs_agendamento` (`cliente_telefone`, migration `20260427220000_painel_cancel_cliente_telefone.sql`) / webhook `web/src/app/api/webhooks/cs-agendamento-notify/route.ts` (lê `cs_clientes.telefone`). Rota `POST /api/whatsapp/notify-professional` envia o texto. Sincronização em tempo real na agenda: `fireNotifyProfessionalFromAgendaDiff` em `painel-notify-professional.ts`.

### Identificação de cliente novo vs retorno
- `cs_clientes.nome` = vazio (`''`) → nunca confirmou o nome → **cliente novo**
- `cs_clientes.nome` = preenchido → nome confirmado via `cs_salvar_nome` → **cliente de retorno**
- `Create Cliente` sempre cria com `nome = ''` (DEFAULT `''` no banco)
- NÃO salvar `pushName` do WhatsApp como nome — é nome do WhatsApp, não confirmado
