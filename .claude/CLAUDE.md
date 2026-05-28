# CLAUDE.md — Consultório 2026

## Papel
Criar, manter e evoluir workflows n8n + banco de dados Supabase para o sistema de atendimento via WhatsApp de clínicas.

---

## ⚠️ SaaS multi-tenant — isolamento por clínica é OBRIGATÓRIO

Este projeto é um **SaaS**: **cada clínica é um tenant isolado** identificado por `clinic_id` (UUID). O mesmo workflow n8n, o mesmo banco Supabase e o mesmo painel web servem **todas as clínicas em paralelo**. Hoje há poucas clínicas activas, mas o sistema é projetado para escalar — assumir sempre que **outras clínicas estão a operar ao mesmo tempo**.

**Regras inegociáveis para qualquer alteração de schema, RPC, workflow ou painel:**

1. **Toda query, RPC e trigger DEVE filtrar por `clinic_id`.** Nunca usar `SELECT … FROM cs_clientes WHERE telefone = X` sem `AND clinic_id = Y` — telefones repetem entre clínicas (mesmo paciente pode ser cliente de duas clínicas).
2. **Nunca hardcodar `clinic_id` em código, RPC ou node n8n.** A clínica é resolvida em runtime pelo `instance_name` (Evolution → `clinics.instancia_evolution`) ou pelo `owner_id` (painel → `auth.users`). Hardcode quebra na hora em que outra clínica usa o mesmo path.
3. **RPCs do agente recebem `p_clinic_id uuid` como primeiro parâmetro** e usam-no em todos os `WHERE`. Sem excepção.
4. **Patches de workflow / SQL de fix nunca devem assumir só a Clínica Saúde.** Se o exemplo precisa de um `clinic_id` (ex.: limpar memória de chat contaminada), explicitar que é por clínica e que outras clínicas podem precisar do mesmo passo separadamente.
5. **Triggers de sync (patients ↔ cs_clientes, professionals ↔ cs_profissionais, appointments ↔ cs_agendamentos, clinic_procedures ↔ cs_servicos) já são tenant-safe** — preservar essa propriedade ao mexer nelas. Qualquer match por telefone/nome tem de incluir `clinic_id` no `ON`.
6. **Painel web filtra pelo `clinic_id` do owner autenticado.** Endpoints internos (`/api/whatsapp/*`, webhooks) têm de validar que o `clinic_id` recebido é o do utilizador autenticado, não confiar no body.
7. **Realtime e listeners (`cs_agendamentos`, `whatsapp_sessions`, `cs_clientes`)** têm de aplicar filtro `clinic_id` no canal Supabase — caso contrário a clínica A recebe eventos da B.
8. **Ao reproduzir um bug, validar em pelo menos duas clínicas mentalmente:** "Se eu tivesse a Clínica X e a Clínica Y a falar ao mesmo tempo, este código continua correcto?" Se a resposta envolver "depende de qual clínica chegar primeiro" ou "porque só há uma clínica activa", o fix está errado.

Violar qualquer um destes pontos resulta em **vazamento de dados entre clínicas** (cliente da A vê agendamento da B, profissional da A é notificado de consulta da B, etc.) — risco crítico para o SaaS.

---

## Instâncias e acesso

| Serviço | URL |
|---|---|
| n8n Editor (UI) | https://n8n.vps7846.panel.icontainer.cloud |
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
- Após editar o JSON local, sempre subir via API (não copiar/colar na UI) — ex.: `node n8n/push-workflow-api.mjs kCX2LfxJrdYWB0vk n8n/workflow-kCX2-live.json --activate`
- Para sincronizar local ← n8n (após editar na UI): `GET /api/v1/workflows/kCX2LfxJrdYWB0vk` e salvar em `workflow-kCX2-live.json`
- Verificar o que está no ar: `node n8n/_verify-live-workflow.mjs` (confere `Monta Contexto` + `agente_agendador` na API)
- O node `AI Agent` (monolítico antigo) está **desconectado** no workflow — mantido apenas como rollback. Não editar nem reconectar sem intenção explícita

### Supabase / Banco
- Toda alteração de schema via `mcp__supabase__apply_migration` E criar arquivo `.sql` em `supabase/migrations/`
- Nomear migrations: `YYYYMMDDHHMMSS_descricao_snake_case.sql`
- RPCs usadas pelo agente n8n: prefixo `n8n_cs_*`

### Profissionais (dual-table com sync automático)
- O painel v2 salva profissionais em `professionals` (campos: `id`, `name`, `specialty`, `whatsapp`, **`gender`** (`M`/`F` → Dr./Dra. nas mensagens WhatsApp ao profissional; migration `20260427200000_professionals_gender_dr_dra.sql`), `is_active`, `clinic_id`, `cs_profissional_id`, **`slot_duration_minutes`** (15/30/60, default 60; migration `20260526230000`), ...)
- O legado/n8n usa `cs_profissionais` (campos: `id`, `nome`, `especialidade`, `ativo`, `clinic_id`, espelho **`gender`**, espelho **`slot_duration_minutes`**)
- **`slot_duration_minutes` (migration `20260526230000_professionals_slot_duration.sql`):** define o intervalo da grade de slots do profissional — 15, 30 ou 60 min (default 60). Exemplo: 30 min → slots 08:00, 08:30, 09:00, 09:30…. Sincronizado para `cs_profissionais` via trigger. As RPCs `painel_cs_ensure_slots_grid` e `n8n_cs_consultar_vagas` usam `COALESCE(pr.slot_duration_minutes, p.slot_duration_minutes, 60)` para gerar os sub-slots com `generate_series(0, 59, slot_duration_minutes)`. **UI:** seletor "Duração de cada atendimento" (botões 15/30/60 min) na secção «Horários de atendimento» do `professionals-manager-modal.tsx`; ao mudar a duração, a grade de horários (semana e sábado) actualiza visualmente em tempo real mostrando os sub-slots correspondentes. O toggle de cada sub-slot afecta a hora inteira (a estrutura `agenda_hours` continua a guardar horas inteiras).
- **Trigger `trg_sync_professional_to_cs`** (migration `20260504330000`, actualizado em `20260526230000`) sincroniza `professionals` → `cs_profissionais` em INSERT, UPDATE **e DELETE**:
  - INSERT: cria nova linha em `cs_profissionais` e preenche `professionals.cs_profissional_id`
  - UPDATE (quando `cs_profissional_id` não é null): atualiza `nome`, `especialidade`, **`gender`**, **`slot_duration_minutes`** e `ativo`
  - DELETE: soft-delete (`ativo = false`) em `cs_profissionais` — histórico de `cs_agendamentos` é preservado
- Tabela **`professional_procedures`** (migration `20260427100000_professional_procedures.sql`): N:N entre `professionals` e `clinic_procedures` — filtra «tipo de consulta» no agendamento do painel e no agente WhatsApp. Campos: `professional_id`, `clinic_procedure_id`, `created_at`, **`duration_minutes`** (migration `20260526220000` — duração específica do profissional para aquele procedimento; nullable, fallback para `clinic_procedures.duration_minutes`). **Regra de vínculo (actualizada 2026-05-06, migration `20260506215000`):** profissional **sem nenhuma linha** em `professional_procedures` → **não aparece** em buscas por procedimento específico (nem via RPC `n8n_cs_consultar_vagas` nem no MAPA do Enrich). Só aparece quando nenhum procedimento é especificado. Para o profissional aparecer para um procedimento, o administrador deve marcar o vínculo no painel (Profissionais → Editar → Procedimentos que realiza). Comportamento anterior («vazio = todos os procedimentos») foi removido para evitar que profissionais não configurados apareçam em especialidades que não realizam.
- **Duração por profissional por procedimento (migration `20260526220000`):** `professional_procedures.duration_minutes` — se preenchido, a RPC `n8n_cs_consultar_vagas` usa essa duração para calcular conflitos de agenda desse profissional específico (ex: Dr. X faz Limpeza em 30 min, Dra. Y em 60 min). Se NULL, usa `clinic_procedures.duration_minutes`. UI: ao marcar um procedimento no painel do profissional, aparece campo numérico `[ XX ] min` ao lado; placeholder mostra a duração padrão da clínica.
- **UI aba Profissionais (`web/src/components/professionals-manager-modal.tsx`, `presentation="panel"`):** mostra primeiro só a lista **Equipa**; **+ Adicionar profissional** abre o formulário novo e **oculta** a lista até **Voltar à lista**, Cancelar, sucesso ao gravar ou Escape. Se `clinic_procedures` estiver vazio, «Procedimentos que realiza» usa **`ProceduresEmptyClinicHint`** (orienta **Clínica / Perfil → Procedimentos**). Modal (`presentation="modal"`) mantém fluxo compacto sem este layout
- **Compat. BD antiga:** `web/src/lib/supabase-gender-column-fallback.ts` (reads sem `gender` se coluna em falta); `web/src/lib/supabase-schema-cache-errors.ts` (ignora sync de vínculos se tabela `professional_procedures` não existir); writes no painel repetem sem `gender`/`professional_procedures` quando o PostgREST devolve erro de schema
- A agenda (`painel_cs_slots_dia`, `painel_cs_ensure_slots_grid`) e as RPCs do agente usam `cs_profissionais` — **nunca editar essas funções para ler de `professionals` diretamente**
- O campo `professionals.cs_profissional_id` é a FK que liga as duas tabelas; se for null, o profissional não aparece na agenda nem no agente
- Ao reportar problemas de profissional não aparecer na agenda, verificar se `cs_profissional_id` está preenchido na tabela `professionals`
- **Órfãos em `cs_profissionais`:** DELETE no painel já faz soft-delete automático (migration `20260504330000`). Duplicados de antes desta migration podem ainda existir com `ativo = true` — limpeza manual na BD se necessário.
- **Painel web — `web/src/components/slots-manager-modal.tsx`:** depois de `painel_cs_slots_dia`, o UI filtra os slots para `profissional_id` ∈ `cs_profissional_id` de linhas **activas** em `professionals` (fallback por nome normalizado só se `cs_profissional_id` for null no painel). Em seguida **merge** de linhas `appointments` (`status = scheduled`, mesmo dia): o merge marca a célula como ocupada («Agend.») com o procedimento — os agendamentos do painel **também bloqueiam** `cs_horarios_disponiveis` via trigger (`trg_appointments_to_cs`), portanto a célula já aparece ocupada via RPC; o merge no UI é uma segunda camada de segurança visual. Células **hora + «—»** (fora da grade da clínica ou indisponível fora da grade): **toque abre sempre** um modal a orientar **Configurar horários da clínica** vs **Profissionais → Horário extra**; `agenda-portal.tsx` liga `onGoToClinicAgendaSettings` (`sidebarPage` → `clinic-hours`) e `onGoToProfessionalsExtraHour` (aba Profissionais com foco no nome).
- **Painel web — `web/src/components/agenda-portal.tsx`:** cancelar agendamento (ícone lixeira) → **modal** próprio com checkbox «Confirmo…» antes de «Sim, cancelar» (sem `window.confirm`). Data no dashboard: **`AgendaDatePickerPopover`** (calendário mensal em vez de só `<input type="date">`). **Sininho / inbox:** diff de `rows` após `loadAppointments` detecta novo / cancelamento / reagendamento (`starts_at` comparado pelo **instante** `Date.getTime`, não só string ISO). Realtime: canal `cs_agendamentos` com filtro `clinic_id` — aplicar migration `20260401120000_realtime_cs_agendamentos.sql` se updates WhatsApp/n8n não refrescarem a lista; há **poll 25 s** e **refetch ao focar** o separador. Preferências do sininho: tipo **reagendamento** desligado = sem entrada nem som. **`painel-notify-professional`:** match de nome do profissional para WhatsApp ignora prefixo **Dr./Dra.** **Toggle agente global:** ver secção «Controlo global do agente» acima — estados `agenteAtivo` + `pauseConfirmOpen` em `agenda-portal.tsx`.

### Serviços (single-source com sync automático)
- O painel v2 é a **fonte de verdade**: `clinic_procedures` (campos: `id`, `name`, `clinic_id`, `duration_minutes`, `is_active`, ...)
- O agente usa `cs_servicos` (campos: `id`, `nome`, `clinic_id`, `duracao_minutos`, `ativo`)
- **Trigger `trg_clinic_procedures_to_cs_servicos`** (migration `20260504320000`) sincroniza automaticamente `clinic_procedures` → `cs_servicos`:
  - INSERT/UPDATE: upsert em `cs_servicos` pelo nome
  - DELETE em `clinic_procedures`: soft-delete (`ativo = false`) em `cs_servicos` — histórico preservado
- A RPC `n8n_cs_agendar` tenta `clinic_procedures` primeiro; se não achar, tenta `cs_servicos` (fallback para serviços criados antes da unificação)
- Quando o serviço vem de `clinic_procedures`, `cs_agendamentos.servico_id` fica **NULL** (sem FK entre as tabelas) — o nome é preservado em `nome_procedimento`
- `cs_agendamentos.servico_id` é **nullable** por design — não adicionar NOT NULL nessa coluna

### Pacientes / Clientes (single-source com sync bidirecional)
- O painel usa `patients` (campos: `id`, `clinic_id`, `phone`, `name`, `email`)
- O agente usa `cs_clientes` (campos: `id`, `clinic_id`, `telefone`, `nome`, `bot_ativo`, CRM fields)
- **Sync bidirecional automático** (migration `20260504300000_sync_patients_cs_clientes.sql`):
  - `patients` INSERT/UPDATE → upsert em `cs_clientes` pelo telefone normalizado (não sobrescreve nome já confirmado)
  - `cs_clientes` UPDATE nome (não-vazio) → upsert em `patients` (nome confirmado via WhatsApp actualiza o painel)
  - Loop guard: flag de sessão `app.syncing_patients` evita cascata infinita entre triggers
- **Normalização de telefone:** função `_phone_digits(text)` remove tudo que não é dígito — permite match entre `+5511999999999` (`patients.phone`) e `5511999999999` (`cs_clientes.telefone`)
- **⚠️ `cs_clientes.telefone` deve conter APENAS dígitos** — nunca salvar o JID completo (`558196454656@s.whatsapp.net`). O `Create Cliente` no n8n deve usar o `remoteJid` sem o sufixo `@s.whatsapp.net` (ex.: `$json.remoteJid.split('@')[0]`). Salvar o JID inteiro cria registros duplicados no painel pois a constraint unique é por string exacta, não por dígitos. Diagnóstico: `SELECT id, telefone FROM cs_clientes WHERE telefone LIKE '%@%'`
- Backfill executado na migration: dados existentes em ambas as tabelas foram sincronizados
- **Identificação de cliente novo vs retorno:** `cs_clientes.nome = ''` → nunca confirmou → novo; preenchido → retorno. `patients` pode ter nome mesmo que `cs_clientes.nome = ''` (nome do admin, não confirmado pelo cliente)

### Agendamentos (dual-table com mirror automático)
- O painel cria agendamentos em `appointments` (campos: `id`, `clinic_id`, `professional_id`, `patient_id`, `starts_at`, `ends_at`, `service_name`, `status`, `source`)
- O agente cria em `cs_agendamentos` (campos: `id`, `clinic_id`, `cliente_id`, `profissional_id`, `data_agendamento`, `horario`, `status`, ...)
- **Trigger `trg_appointments_to_cs`** (migration `20260504310000_appointments_mirror_cs_agendamentos.sql`):
  - INSERT em `appointments` (status='scheduled'): bloqueia slot em `cs_horarios_disponiveis` + cria mirror em `cs_agendamentos` com `from_appointments_id = appointments.id` e `painel_confirmado = true`
  - UPDATE starts_at/professional (reagendamento): liberta slot antigo, bloqueia slot novo, atualiza mirror
  - UPDATE status → 'cancelled'/'completed': liberta slot, atualiza mirror para 'cancelado'/'concluido'
- **`from_appointments_id uuid`** em `cs_agendamentos`: quando preenchido indica que a linha é mirror de `appointments`. `painel_list_cs_agendamentos` **exclui** estas linhas (`WHERE from_appointments_id IS NULL`) — evita duplicados na agenda do painel (os agendamentos do painel já aparecem via `appointments` directamente)
- **Bug crítico corrigido:** antes desta migration, agendamentos criados no painel não bloqueavam `cs_horarios_disponiveis` → agente podia oferecer o mesmo slot → dupla marcação. Agora é impossível.
- **Agente vê agendamentos do painel:** `agd_cs_buscar_agendamentos` encontra o mirror em `cs_agendamentos` quando paciente pergunta "qual é a minha consulta?" via WhatsApp
- O mirror só é criado se o profissional tiver `cs_profissional_id` e o paciente tiver entrada em `cs_clientes` (garantido pelo sync de patients)

### Limpeza periódica de chat memory
- **Workflow n8n `OwC7Y54kWZTB4Y1P`** ("Cleanup Chat Memory (90 dias)") roda diariamente às **3:30 BRT** chamando `rpc/n8n_cleanup_chat_histories(p_days: 90)`. Migration: `20260527164500_n8n_cleanup_chat_histories.sql`.
- A RPC apaga apenas sessões cuja **última msg seja anterior a 90 dias** (preserva sessões activas inteiramente). Não afecta `cs_clientes`/`cs_agendamentos`/`cs_clinic_directory` — apenas memória conversacional do LLM. Identidade do cliente e agendamentos persistem.
- Justificativa: chat memory antiga pode conter listas de profissionais já obsoletas (ex.: cliente que conversou há 6 meses tem nomes de profs que já saíram). MAPA ao vivo do Enrich sobrepõe, mas há risco residual de o LLM regurgitar memória antiga. Limpeza periódica reduz esse risco.
- Para mudar retenção: editar `jsonBody` do node `Call cleanup RPC` (alterar `p_days`). Para mudar horário: `cronExpression` no Schedule Trigger.

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
- **`clinics.slot_duration_minutes smallint NOT NULL DEFAULT 60`** (migration `20260526240000`): duração padrão dos slots da clínica inteira (15/30/60 min). Usado no painel `clinic-agenda-hours-modal.tsx` para gerar a grade visual de sub-slots (ex: 30 min → 08:00, 08:30, 09:00…). Cada profissional pode ter o seu próprio `slot_duration_minutes` que sobrepõe o da clínica.
- `cs_clientes`, `cs_agendamentos`, slots, serviços, profissionais — tudo filtrado por `clinic_id`
- Ao criar RPCs novas, sempre receber `p_clinic_id uuid` como primeiro parâmetro

### Agente WhatsApp (fluxo resumido)
1. Webhook recebe mensagem → `Campos iniciais` extrai dados
2. `Code merge webhook e resolucao` resolve `clinica_id` pelo `instance_name`
3. `Buscar Config Cl?nica` (HTTP Request → Supabase REST) busca dados da clínica (incluindo `agent_instructions` e **`agente_ativo`**)
   - **Atenção:** o nome real do node no n8n contém `?` literal (encoding corrompido de `í`). Sempre referenciar como `$('Buscar Config Cl?nica')` em Code nodes
   - `Get Empresa` (Supabase node) existe no workflow mas está em outro ramo — **não** é o que alimenta o Monta Contexto
3.5. **`IF Agente Ativo`** — node inserido entre `Buscar Config Cl?nica` e `Check First Contact`. Se `agente_ativo === false` (clínica pausou o bot pelo painel) → o fluxo termina silenciosamente; se `true` → continua normalmente
4. `Check First Contact` (Postgres) conta histórico de chat para detectar primeiro contato
5. `Get Cliente` busca cliente por `clinic_id` + `telefone`
6. `Verificar se cliente está cadastrado`: se não existe → `Create Cliente` com `nome = ''`
7. `Bot inativo` verifica se atendimento humano assumiu
7.5. **Processamento de mídia** — `Verifica se é Image, Texto ou Áudio1` (Switch) roteia por `msgType`:
   - `audioMessage` → `? realmente áudio?` → `HTTP Request1` (transcrição) → `Transcreve1` → `RegistraMsgFila`
   - `imageMessage` → `? realmente imagem?` → `Pega o base64 da imagem1` → **`IF base64 válido`** → `Baixa a imagem1` → `Descreve o que está na imagem1` (GPT-4o) → `RegistraMsgFila`
     - **⚠️ `IF base64 válido` (fix 2026-05-27):** Evolution API às vezes não inclui base64 na payload de imagem (imagens grandes ou falha de download) — `base64` chega `null`. Sem este guard, `Baixa a imagem1` (ConvertToFile) crash com "first argument must be string or Buffer". FALSE branch → `Edit Fields3` (trata como texto). Patch: `n8n/patch-imagem-base64-guard.mjs`
   - texto → `No Op - IF mídia é texto` → `Edit Fields3` → `RegistraMsgFila`
8. Fila Redis — fluxo linear: `RegistraMsgFila` → `BuscaMensagens` → `Aguarda 13 segundos` → `VerificaMensagens` (GET) → `OrganizaMensagem` → `ResetaFila`. `keyType: list` nos GETs. Push: `JSON.stringify(Object.assign({}, JSON.parse(JSON.stringify($json)), { wppKeyId }))` (não usar `...$json` no expression — n8n 2.x / Redis `lPush` exige string). `OrganizaMensagem` deduplica.
9. `Monta Contexto` (Code node) monta payload para os agentes:
   - lê dados da clínica via `$('Buscar Config Cl?nica').first().json` (não via `$input`)
   - injeta `clinic_name`, `nome_agente`, `agent_instructions`, `saudacao_novo/retorno`
   - substitui placeholders `{{name}}`, `{{clinica}}`, `{{periodo}}` em `saudacao_novo` e `agent_instructions`
   - injeta `clinic_id`, `remoteJid`, `instanceName` (usados pelos agentes e handoff)
   - injeta `instr_triagem`, `instr_faq`, `instr_transferir` (seções de `agent_instructions`)
   - `instr_outros` ainda pode existir no Code node por compatibilidade com dados legados, mas não é alimentado pelo painel
   - **Calendário (America/Sao_Paulo):** calcula `cal_hoje_ymd`, `cal_hoje_br`, `cal_hoje_weekday`, `cal_amanha_ymd`, `cal_amanha_br`, `cal_amanha_weekday` e acrescenta ao `agent_instructions` o bloco **CALENDÁRIO OBRIGATÓRIO** — o `agente_agendador` usa `{{ $json.cal_amanha_ymd }}` no system message para «amanhã» bater com a data real (evita confundir com outro dia, ex. fim de semana). Script de manutenção: `n8n/patch-monta-contexto-calendario.mjs`
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

#### `agente_agendador` — tools, confirmação e UX de vagas
- **Nomes das tools no n8n:** o sub-agente usa prefixo **`agd_cs_*`** (`agd_cs_consultar_vagas`, `agd_cs_agendar`, …). O system message deve referir estes nomes (não `cs_agendar` só), senão o modelo tende a não chamar a tool. Manutenção: `n8n/patch-agendador-sm-tools-ok.mjs` (substituições com `(?<!agd_)` para não gerar `agd_agd_cs_`).
- **Confirmação:** é proibido dizer que agendou sem JSON da tool de escrita com **`ok: true`**.
- **Erros de tool (seção `## ERROS DE TOOL` no SM):** o agente **nunca** deve dizer ao cliente "houve um problema técnico", "vou tentar novamente" ou "um momento" como reação a falha interna. Se tool falha: tentar com parâmetros corrigidos; se persistir, dizer apenas "Não consegui verificar os horários agora, tente em instantes."
- **Mensagem ao cliente (seção `## MENSAGEM AO CLIENTE` no SM):** usa modelo obrigatório — proibido texto livre. Formato actual (actualizado 2026-05-04): `O seu agendamento para {servico} está confirmado ✅` → `📅 Data: {dia de mês-por-extenso de ano} (amanhã/hoje se aplicável)` → `⏰ Horário: {HH}h ou {HH}h{MM}` → `👨‍⚕️ Profissional: {Dr_ou_Dra_nome}` → linha em branco → `Qualquer dúvida ou necessidade, estou à disposição! 😊`. Mesma estrutura para reagendamento (Nova data / Novo horário) e cancelamento (sem emoji ✅ final, encerrar com convite a remarcar).
- **Fluxo busca de horários — 2 etapas obrigatórias (actualizado 2026-05-06):**
  - **Etapa 2A:** com o procedimento confirmado, o agente lê o **`## PROFISSIONAIS APTOS — DADOS AO VIVO`** injectado pelo `Enrich Agendador` e mostra **apenas os nomes** dos profissionais aptos — **sem chamar nenhuma tool**, sem mostrar horários. Pergunta: «Com qual profissional prefere?»
  - **Etapa 2B:** após o cliente escolher, chama `agd_cs_consultar_vagas` com `data_solicitada` + `procedimento` + **`profissional_id`** (UUID do profissional escolhido) → devolve slots apenas desse profissional. Lista máx. 10 horários; se mais → perguntar manhã/tarde.
  - **PROIBIDO:** chamar `agd_cs_consultar_vagas` sem `profissional_id` e depois listar grade completa (horários × múltiplos profissionais).
  - **Sem vagas hoje → amanhã automático (2026-05-26):** se `agd_cs_consultar_vagas` retornar `[]` para o dia pedido, o agente chama automaticamente para o dia seguinte com os mesmos parâmetros e mostra os slots sem perguntar ao cliente.
- **`Enrich Agendador`** injeta no contexto o bloco **`## PROFISSIONAIS APTOS — DADOS AO VIVO [HH:MM:SS]`**: mapa calculado em runtime (serviços + `professional_procedures` do banco) com timestamp de geração. O timestamp instrui o LLM a usar esta lista como fonte única de verdade, sobrepondo qualquer lista de profissionais do histórico de conversa — resolve o problema SaaS de profissional novo não aparecer em sessões em andamento. Profissionais sem nenhum vínculo em `professional_procedures` **não aparecem** neste mapa nem nos resultados da RPC quando um procedimento é especificado — precisam ter os procedimentos configurados no painel.
- Script de patch do SM: `n8n/patch-agendador-sm-vagas-curtas.mjs`, `n8n/patch-agendador-sm-filtro-procedimento.mjs`
- O ramo agendamento passa por `IF mensagem vÃƒÂ¡lida` → prefetch HTTP → **`Enrich Agendador`**, que faz spread do contexto; os `cal_*` vindos de `Monta Contexto` chegam ao `agente_agendador` via `Code Extrair Rota` (`...montaCtx`).

#### `Enrich Agendador` (id: `enrich-agendador-prefetch`) — arquitectura e armadilhas
- **Cadeia única (sem double-execution, 2026-05-27):** `IF mensagem vÃƒÂ¡lida` → `HTTP Fetch Profissionais` → **`Enrich: Context Relay`** → `HTTP Fetch Servicos` → **`Enrich: Merge All`** → `Enrich Agendador`. Não há mais conexão directa IF → Enrich, eliminando o double-execution. Patch: `n8n/patch-enrich-relay-architecture.mjs`.
- **`Enrich: Context Relay`** (id: `enrich-relay-context`) — Code node entre HTTP Prof e HTTP Svcs: usa `$('IF mensagem vÃƒÂ¡lida').first().json` (2 hops atrás ✓) e **`$input.all().map(i => i.json)`** (HTTP Prof response — **n8n FRAGMENTA o JSONB array** do Supabase em múltiplos itens, um por profissional), emite `{ ...ctx, _httpProf: arrayDeObjectos }`. `HTTP Fetch Servicos` usa `$input.first().json.clinic_id` (não mais `$('IF...')`) porque `clinic_id` já vem no item.
- **⚠️ ARMADILHA n8n HTTP Request + Supabase RPC array**: quando o body é uma resposta JSONB array, **n8n fragmenta em N itens** (um por elemento do array). `$input.first().json` captura **apenas o primeiro elemento** — perda silenciosa. **Sempre usar `$input.all().map(i => i.json)`** para reconstruir o array original. Bug histórico (2026-05-27): o Relay capturava só o Camilo (primeiro prof alfabético), MAPA vazio, agendador respondia com lista errada e dizia "Vou consultar as vagas" sem listar profissionais (causa raiz original do "só Dr. Herick" e do erro `The model produced invalid content` do OpenAI).
- **Enrich não chama `parseProfissionaisRpc` para `_httpProf`**: o array já vem no formato correcto (objectos com `id`, `nome`, `especialidade`, `procedimento_ids`). Usar directamente: `profs = httpProfArr.filter(p => p && p.id && p.nome)`. **Não passar pelo `extractSupabaseArray`** — essa função recursa em `Object.values` e devolve o array `procedimento_ids` do primeiro prof como se fossem os profissionais, causando profBlock com `?`/`undefined` e sem MAPA.
- **`Enrich: Merge All`** (id: `enrich-merge-all`) — Code node entre HTTP Svcs e Enrich: lê `$('Enrich: Context Relay').first().json` (2 hops ✓) + `$input.first().json` (HTTP Svcs response), emite `{ ...ctx, _httpProf, _httpSvcs }`.
- **`Enrich Agendador` lê tudo de `$input.first().json`** — sem `$()` calls para HTTP nodes, sem guard. `ctx._httpSvcs` = dados de serviços; `ctx._httpProf` = dados de profissionais. `ctx.mensagem`, `clinic_id`, etc. estão todos no mesmo item.
- **⚠️ n8n 2.10.x task runner — `$('nodeName')` só funciona para nós próximos:** falha para nós 3+ hops atrás. O Relay usa `$('IF mensagem vÃƒÂ¡lida')` (2 hops), o Merge usa `$('Enrich: Context Relay')` (2 hops) — ambos dentro do limite. **Nunca mover Enrich Agendador para chamar `$('IF...')` directamente** (seria 4+ hops).
- **`extractSupabaseArray(raw)`** — helper que lida com os dois formatos de resposta Supabase:
  - `HTTP Fetch Profissionais` (JSON format): resposta é `{"n8n_cs_profissionais_para_agente": [...]}` → extrai o array do valor do objecto
  - `HTTP Fetch Servicos` (text format, `responseFormat: "text"`): resposta é `{body: "[{\"n8n_clinic_procedimentos\": [...]}]"}` → parse do `body` string + extrai array do wrapper
  - Identifica array de dados (tem `id` ou `nome`) vs array wrapper (tem chave de função RPC) — extrai um nível mais fundo se necessário
- **`procedimento_ids` em `n8n_cs_profissionais_para_agente`** (migration `20260527143800` — reverteu `20260526250000`): a RPC devolve `clinic_procedures.id` (via `pp.clinic_procedure_id`) — consistente com `n8n_clinic_procedimentos` e `n8n_cs_consultar_vagas`. O Enrich filtra com `p.procedimento_ids.some(x => String(x) === hid)` onde `hid` é o `s.id` de `n8n_clinic_procedimentos` (= `clinic_procedures.id`). **⚠️ Não voltar a usar `cs_servicos.id` aqui** — causa ID mismatch e o MAPA fica vazio (bug de 2026-05-27: só Dr. Herick aparecia para Limpeza mesmo com 3 profissionais vinculados)
- **Contaminação da memória de chat:** se o bot enviar expressões literais `{{ $json.xxx }}` para o cliente (resultado de erro de execução anterior armazenado na memória Postgres), limpar: `DELETE FROM n8n_chat_histories WHERE session_id = 'clinic_id:telefone@s.whatsapp.net'`

#### Regra do qualificador (`agente_atende_qualifica`)
- O qualificador **NÃO deve dizer** "Vou verificar", "Um momento", "Aguarde" ou qualquer frase que implique que ele fará algo — essas ações são dos agentes especializados
- Resposta correta: confirmar a intenção brevemente e incluir a tag — ex: `"Certo! [ROTA: agendamento]"`
- Se o qualificador disser "Vou verificar" sem a tag → o `Code Extrair Rota` vai inferir `agendamento` pelo fallback (comportamento correto), mas a resposta enviada ao cliente será esse "Vou verificar..." em vez do resultado do agendador — experiência ruim mas funcional
- **Bug confirmado (2026-05-04):** quando o cliente envia resposta curta no meio de um agendamento (ex: digita só o nome do profissional para escolhê-lo), o qualificador usava a memória do chat para fabricar a mensagem de confirmação completa (`"O agendamento foi confirmado"`) sem chamar nenhuma tool — o agendador nunca era acionado e nenhuma linha era criada em `cs_agendamentos`. Fix: adicionadas regras ⛔ PROIBIDO no SM do qualificador (2026-05-04). Se esse comportamento reaparecer, revisar o system message do nó `agente_atende_qualifica`.
- **Saudação 1º contato (actualizado 2026-05-04):** SM instrui a incluir SEMPRE `"Sou {nome_agente}, da {clinic_name}."` na primeira mensagem, mesmo que o template `saudacao_novo` da clínica não inclua o nome do agente.
- **BLOQUEIO NOME (actualizado 2026-05-04):** se `nome_cliente` estiver vazio E não for o 1º contato (`primeiro_contato=false`) → o qualificador é obrigado a pedir "Qual é o seu nome e sobrenome?" e usar `[ROTA: concluido]`. SÓ após `cs_salvar_nome` confirmar pode encaminhar para outro agente. Sem esta regra o bot encaminhava directamente para o agendador sem coletar o nome.

### Agendar vs reagendar (duplicados na grade)
- Se o cliente **já** tem consulta activa com o **mesmo** profissional na **mesma** data, `n8n_cs_agendar` responde `ok: false`, `error: ja_existe_agendamento_mesmo_dia` e devolve `agendamento_id` — usar **`n8n_cs_reagendar`** com esse id. Chamar `cs_agendar` de novo cria um **segundo** `cs_agendamentos` e o painel mostra dois horários «AGEND.».
- `n8n_cs_reagendar` liberta o slot antigo com `date_trunc('minute', horario)` e cancela duplicados órfãos no slot antigo após mover o registo principal.

### Cancelar via agente (`n8n_cs_cancelar`)
- Migration **`20260424193000_n8n_cs_cancelar_rowcount_slot_from_row.sql`**: a RPC **já não** devolve `ok: true` quando o `UPDATE` não cancela nenhuma linha (id inexistente / erro). Liberta **`cs_horarios_disponiveis`** com **data e horário lidos da própria linha** em `cs_agendamentos` (com `date_trunc(minute)`), não só com `p_data`/`p_horario` da tool — evita slot errado após **reagendar** com parâmetros antigos no n8n. `profissional_whatsapp` na resposta usa o profissional **da linha cancelada**. Se o WhatsApp do cliente diz «cancelado» mas o painel não muda, o agente pode estar a responder sem tool ou com `agendamento_id` errado; com a RPC nova o JSON traz `ok: false` e `error` explícito.

### Tools por Agente

| Tool (node n8n) | Agente | RPC / Destino |
|---|---|---|
| `qualifica_cs_salvar_nome` | qualifica | `n8n_cs_salvar_nome` — salva nome confirmado |
| `agd_cs_consultar_servicos` | agendador | `n8n_clinic_procedimentos` — lista procedimentos |
| `agd_cs_consultar_profissionais` | agendador | `cs_profissionais` — lista profissionais; tem placeholder dummy `chamada` (obrigatório n8n 2.10.x — ver nota abaixo) |
| `agd_cs_profissionais_aptos_procedimento` | agendador | `n8n_cs_profissionais_aptos_procedimento` — filtra profissionais aptos ao procedimento; placeholders `aptos_uuid` (UUID do catálogo) e `aptos_nome` (nome texto); preencher um ou ambos |
| `agd_cs_consultar_vagas` | agendador | `n8n_cs_consultar_vagas` — **4 placeholders**: `data_solicitada` (YYYY-MM-DD, obrigatório), `servico_id` (UUID opcional), `procedimento` (nome texto opcional), **`profissional_id`** (UUID do profissional — obrigatório na Etapa 2B após cliente escolher); `jsonBody` é expression que resolve `p_clinic_procedure_id`/`p_procedimento_nome`/`p_profissional_id` a partir dos placeholders + `_procedimento_tool_hint` do Enrich; `profissional_id` também aparece na URL (fragmento `#`) para satisfazer validação n8n; **não enviar `p_exigir_procedimento`** (parâmetro removido da RPC em `20260502`); na Etapa 2A (sem profissional ainda) o `p_profissional_id` fica `null` |
| `agd_cs_agendar` | agendador | `n8n_cs_agendar` — cria agendamento |
| `agd_cs_buscar_agendamentos` | agendador | `n8n_cs_buscar_agendamentos` — consulta agendamentos |
| `agd_cs_reagendar` | agendador | `n8n_cs_reagendar` — reagenda |
| `agd_cs_cancelar` | agendador | `n8n_cs_cancelar` — cancela |
| `agd_cs_notificar_profissional` | agendador | Evolution API — envia WhatsApp ao profissional |
| `faq_cs_consultar_servicos` | faq | `n8n_clinic_procedimentos` — lista serviços |
| `esp_cs_consultar_servicos` | especialista | `n8n_clinic_procedimentos` — detalhes do procedimento |

> Cada agente tem também um **Refletir** (Think tool) para raciocínio antes de responder.
> Os nodes `agd_*`, `faq_*`, `esp_*` são cópias independentes — não compartilhar entre agentes.

> **n8n 2.10.x — bug de schema em tools sem `placeholderDefinitions`:** Tools `toolHttpRequest` sem nenhum `placeholderDefinitions` definido geram schema com chave vazia obrigatória → erro `Required → at ` no agente. Solução: sempre adicionar pelo menos um placeholder dummy `chamada` (type `string`) com descrição, mesmo que a tool não precise de input. Exemplo: `cs_consultar_profissionais` e `agd_cs_consultar_profissionais`.

> **n8n — placeholder definido mas não usado em campo visível → `Misconfigured placeholder` error:** Todo placeholder em `placeholderDefinitions` deve aparecer em pelo menos um campo do node que o n8n valida (URL, headers, query params) usando a sintaxe `{placeholder}` literal — não basta estar só dentro de uma expressão JS no `jsonBody`. Solução usada em `agd_cs_consultar_vagas`: os 4 placeholders (`data_solicitada`, `servico_id`, `procedimento`, `profissional_id`) aparecem todos no fragmento `#` da URL (`'#' + '{data_solicitada}' + '|' + ...`) além de serem usados na expressão do `jsonBody`.

### Notificação de profissionais
- O workflow tem **Code auto-notify profissional** (após o agendador): chama `n8n_cs_profissional_whatsapp_mudanca_recente` quando a resposta parece mutação; usa só dígitos no telefone; janela de «mudança recente» **25 min** no Supabase. O texto inclui **telefone do cliente**: tenta `cs_agendamentos.cliente_id` → `cs_clientes.telefone` (GET); fallback para `ctx.remoteJid` (número da conversa, sempre disponível) se a query não resolver.
- **Formato das mensagens** (padrão unificado em `professional-notify-message.ts` e Code node): cabeçalho `{Dr/Dra Nome}, você tem um …:` → linha em branco → indicador de tipo (`🟢 Novo agendamento` / `🟡 Reagendamento` / `🔴 Cancelamento`) → linha em branco → campos com emojis: `👤 Cliente`, `📱 Telefone`, `📌 Serviço`, `📅 Data`, `🕒 Horário`. Mensagem ao cliente segue o mesmo padrão (sem linha de cliente/telefone).
- O system message do agendador diz para **não** chamar `agd_cs_notificar_profissional` — o fluxo notifica via este Code node quando a RPC devolve `profissional_whatsapp`.
- O `profissional_whatsapp` vem das RPCs via `LEFT JOIN professionals ON cs_profissional_id = cs_profissionais.id`
- O campo `professionals.whatsapp` (e resto do cadastro) é configurado no painel — **UI** em `professionals-manager-modal.tsx` está descrita na secção **Profissionais (dual-table)** acima
- Se o profissional não tiver WhatsApp cadastrado, `profissional_whatsapp` retorna `null` e a notificação é pulada silenciosamente
- O node tool `agd_cs_notificar_profissional` existe no workflow mas o comportamento pretendido é notificação automática no fluxo (Evolution), não depender do LLM para esse passo
- **Painel Next.js (Evolution):** `web/src/lib/professional-notify-message.ts` formata novo / reagendar / cancelar com linha **📱 Telefone** do cliente quando `clienteTelefone` / `patients.phone` / RPC `painel_cancel_cs_agendamento` (`cliente_telefone`, migration `20260427220000_painel_cancel_cliente_telefone.sql`) / webhook `web/src/app/api/webhooks/cs-agendamento-notify/route.ts` (lê `cs_clientes.telefone`). Rota `POST /api/whatsapp/notify-professional` envia o texto. Sincronização em tempo real na agenda: `fireNotifyProfessionalFromAgendaDiff` em `painel-notify-professional.ts`.

### Controlo global do agente (toggle por clínica)
- **`clinics.agente_ativo boolean NOT NULL DEFAULT true`** (migration `20260502190000_clinics_agente_ativo.sql`) — liga/desliga o bot para **todos** os clientes da clínica de uma vez
- **n8n:** node `IF Agente Ativo` (posição entre `Buscar Config Cl?nica` e `Check First Contact`) verifica `$json.agente_ativo === false`; o select de `Buscar Config Cl?nica` inclui `agente_ativo`. Se desligado, o fluxo para sem responder
- **Clínica Saúde — clinic_id único:** `5c8f7a44-c6b3-4835-889b-7e9f9b009125` — owner `01b7e850` (`felipeari2007@gmail.com`). Migration `20260504400000_merge_clinica_saude_owner.sql` fundiu a clínica fantasma `7619e1f6` (estava vazia, criada por engano) nesta. Painel e n8n agora usam o mesmo `clinic_id`. Se o agente parar de responder, verificar `SELECT id, name, agente_ativo FROM clinics WHERE id = '5c8f7a44-c6b3-4835-889b-7e9f9b009125'`.
- **⚠️ Troubleshooting login → redireciona para /cadastro:** o painel resolve a clínica pelo `clinics.owner_id` do utilizador autenticado. Se `owner_id` for `null` na linha da clínica (pode acontecer em clínicas criadas manualmente no banco), o utilizador autentica mas não encontra clínica → vai para `/cadastro`. Diagnóstico: `SELECT c.id, c.name, c.owner_id FROM clinics c LEFT JOIN auth.users u ON u.id = c.owner_id WHERE u.email = '<email>'`. Fix: `UPDATE clinics SET owner_id = '<auth_user_id>' WHERE id = '<clinic_id>'`.
- **Painel web (`agenda-portal.tsx`):**
  - Estado: `agenteAtivo` (boolean, carregado do `clinics.agente_ativo` no fetch inicial junto com `id, name`)
  - Toggle no **footer do sidebar desktop** e no **footer do drawer mobile** — switch visual verde/âmbar com texto "Agente ativo" / "Agente pausado"
  - **Modal de confirmação** ao pausar (`pauseConfirmOpen`): só aparece ao desligar (ativo → pausado); reativar não pede confirmação. Botão "Sim, pausar agente" chama `confirmPauseAgente()` que grava `agente_ativo: false` no Supabase
  - **Status bar** (topo do painel): "IA activa" (verde, animado) quando WhatsApp conectado + agente ativo; "IA pausada" (âmbar) quando WhatsApp conectado + agente pausado
  - **Bug fix (2026-05-04):** `handleToggleAgente` usava `void` na reactivação — erros do Supabase eram silenciados e o UI mostrava "ativo" mas o banco ficava `false`. Corrigido: agora `async/await` com revert de estado em caso de erro. `confirmPauseAgente` também revert se o update falhar. Path de membro (`clinic_members`) agora carrega `agente_ativo` do banco (antes ficava sempre no default `true`).

### Controlo do bot por cliente (`cs_clientes.bot_ativo`)
- **`bot_ativo`** em `cs_clientes` controla se o agente responde para um **cliente específico** (independente do toggle global)
- **Três modos de pausa (`whatsapp_sessions.pause_mode`, migration `20260527210000_pause_mode_rolling.sql`):**
  - **`manual`** — painel pausou em modo Manual; `pause_until = 9999-12-31`; só o toggle do painel reactiva. RPC nunca reactiva.
  - **`timed`** — painel pausou com duração específica (10 min / 1h / 24h / etc); `pause_until = now + X`; quando expira, próxima mensagem do cliente reactiva. Cliente a mandar mensagem durante a janela **não** prolonga (a duração escolhida pelo utilizador é respeitada).
  - **`rolling`** — staff respondeu via WhatsApp; `pause_until = now + 10 min` renovável; cada mensagem (staff **ou** cliente) renova a janela. Bot só volta após 10 min de **silêncio total**.
  - `n8n_cs_staff_assumir_sessao` preserva mode `manual` e `timed` (vindas do painel); só altera para `rolling` se a sessão ainda não tinha pause ou já era rolling.
  - `n8n_cs_verificar_reativar_bot` em modo `rolling`: se não expirou, estende `pause_until = now + 10 min` antes de devolver `reativado:false`. Em `timed`: respeita a duração. Em `manual`: nunca reactiva.
- Quando o staff envia mensagem via WhatsApp da clínica (fromMe=true), o fluxo **`IF Staff fromMe` → `Code Staff WhatsApp Assumir` → `HTTP Staff Assumir Sessão`** detecta e chama a RPC `n8n_cs_staff_assumir_sessao(p_instance_name, p_phone)` que faz `bot_ativo = false` para aquele cliente e insere/atualiza `whatsapp_sessions` com `staff_handling = true`
  - **Arquitectura paralela:** `IF Staff fromMe` está ligado do Webhook **em paralelo** com `Filter1` (ambos na mesma saída `main[0]` do Webhook). Isso significa que `IF Staff fromMe` corre para **todas** as mensagens; se `fromMe=false` (cliente), avalia como FALSE e não faz nada — a execution view sempre o mostra como executado mesmo em mensagens normais. Não é bug.
  - **Bug fix (migration `20260502181739`):** a RPC usava `WHERE instance_name = ...` mas a coluna em `clinics` chama-se `instancia_evolution`; já corrigido
  - **⚠️ `clinics.instancia_evolution` DEVE estar preenchida** — a RPC `n8n_cs_staff_assumir_sessao` resolve a clínica por `WHERE instancia_evolution = p_instance_name`. Se for NULL, a RPC retorna `clinica_nao_encontrada` e o handoff nunca funciona (o agente continua respondendo mesmo quando a clínica manda mensagem). O valor deve bater com `n8n_clinic_directory.instance_name`. Para a Clínica Saúde: `'clinica-5c8f7a44-c6b3-4835-889b-7e9f9b009125'` (corrigido 2026-05-06). **Diagnóstico:** `SELECT id, name, instancia_evolution FROM clinics WHERE instancia_evolution IS NULL` — qualquer linha aqui tem handoff quebrado.
  - **Echo fix (2026-05-06 — aplicado ao workflow):** a Evolution API dispara webhook com `fromMe=true` + `status=PENDING` para cada mensagem que o próprio bot envia — isso acionava falsamente o staff takeover. Corrigido adicionando segunda condição ao `IF Staff fromMe`: `$json.body?.data?.status !== 'PENDING'` (id: `staff-skip-pending`). Mensagens reais do staff chegam como `DELIVERY_ACK`/`SENT`; echoes chegam como `PENDING`.
- **Auto-reativação (migration `20260527210000` substitui o critério legado de 10 min via `updated_at`):** o n8n verifica no node **`HTTP Verifica Inatividade 10min`** (TRUE branch de "Bot inativo") → chama RPC `n8n_cs_verificar_reativar_bot` → **`IF Bot Reativado`** (TRUE → fluxo normal retoma; FALSE → NoOp). Critério único: `staff_handling = true` E `pause_mode <> 'manual'` E `pause_until` no passado. Para mode `rolling`, o RPC também estende `pause_until` quando o cliente manda mensagem mas a janela ainda não expirou. O caminho legado "pause_until IS NULL + 10 min de updated_at" foi removido (causava reativação silenciosa de clientes antigos com sessão de staff órfã — migration `20260527190000` fez o backfill).
- **`cs_clientes.updated_at` como proxy do último chat:** trigger **`trg_chat_history_update_cs_clientes`** (migration `20260506172200`) atualiza `updated_at` a cada INSERT em `n8n_chat_histories`, extraindo `clinic_id` e telefone do `session_id` (`clinic_id:phone@s.whatsapp.net`). Grupos (`@g.us`) são ignorados. Só atualiza se o novo timestamp for mais recente. Isso garante que a lista "Conversas" reflita o último chat real, não a última edição do registo.
- **Painel web (`painel-clientes-cs.tsx`)** — redesenhado com **duas abas:**
  - **Conversas** (padrão): clientes com `updated_at` preenchido, ordenados do mais recente (último a falar primeiro); cada card mostra avatar, nome, telefone, tempo relativo ("há 5 min") e **toggle switch** Agente ativo / Pausado por cliente
  - **Todos os clientes**: lista CRUD completa (editar nome, apagar) + toggle de bot em cada linha
  - Toggle ao **pausar**: abre modal com opções de duração (10 min, 30 min, 1h, 2h, 4h, 8h, 24h, **Manual**). Confirma → `UPDATE cs_clientes SET bot_ativo = false` + upsert `whatsapp_sessions` com `staff_handling = true`, `pause_mode = 'manual' | 'timed'` e `pause_until` correspondente. Toggle ao **reativar manualmente**: `bot_ativo = true` + limpa `staff_handling`, `pause_mode`, `pause_until` na sessão.
  - **Status efectivo no painel (`botEffective`)**: o toggle mostra ATIVO mesmo com `bot_ativo = false` no banco se a pausa já venceu (`pause_until` no passado, modo não-manual). Tick de 60 s força re-render sem evento do banco.
  - **Countdown "reativação manual" / "reativa em Xh Ymin"**: lê `pause_until` directamente. Pausa manual mostra "reativação manual"; pausa temporizada mostra contagem decrescente. Realtime de `whatsapp_sessions` + `cs_clientes` (publicação adicionada em `20260527180000`) actualiza tudo em tempo real.
  - **⚠️ Duplicados por JID no telefone**: `cs_clientes.telefone` deve conter só dígitos — nunca `558196454656@s.whatsapp.net`. Diagnóstico: `SELECT id, telefone FROM cs_clientes WHERE telefone LIKE '%@%'`
- **`Filter1`** (webhook → fluxo principal): única condição `fromMe === false` — condição de teste com número fixo `558196454656` foi removida (estava em AND e bloqueava todos os outros clientes)

### Identificação de cliente novo vs retorno
- `cs_clientes.nome` = vazio (`''`) → nunca confirmou o nome → **cliente novo**
- `cs_clientes.nome` = preenchido → nome confirmado via `cs_salvar_nome` → **cliente de retorno**
- `Create Cliente` sempre cria com `nome = ''` (DEFAULT `''` no banco)
- NÃO salvar `pushName` do WhatsApp como nome — é nome do WhatsApp, não confirmado
