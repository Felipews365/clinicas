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

### Lembretes automáticos da clínica
Sistema de 2 fluxos agendados que disparam WhatsApp aos pacientes. Migrations principais: `20260528180000_lembretes_runtime.sql`, `20260528190000_lembretes_per_procedimento.sql`, `20260528200000_lembretes_limit_top_50.sql`.

#### Lembrete de consulta (cron 15 min — workflow `n8n/workflow-lembretes-consulta.json`)
- **UI** (`clinic-profile-panel.tsx` → aba Lembretes): dropdown «Enviar lembrete quanto tempo antes» (30/60/…/2880 min ou null) → grava `clinics.agent_instructions->>'lembrete_antecedencia_minutos'`. Textarea com template suporta `{{nome}}`, `{{data}}`, `{{hora}}` → `lembrete_mensagem`. **Pré-visualização ao vivo** estilo bolha WhatsApp (`#005c4b` sobre `#0b141a`) com `nome=João, data=15/06/2026, hora=14:30` — substitui as variáveis e renderiza `*negrito*`. Lê o mesmo `lembreteMensagem || LEMBRETE_MENSAGEM_PADRAO` do RPC, então o que se vê é literalmente o que sai.
- **RPC `n8n_cs_lembretes_consulta_pendentes()`** (sem args): joga todas as clínicas activas que têm antecedência configurada + dentro do horário (`_clinic_aberta_agora`), calcula `(data+hora) AT TIME ZONE 'America/Sao_Paulo' - antecedencia` e devolve agendamentos cujo alvo caiu na janela `[now()-20min, now()]` e ainda não foram enviados (`NOT EXISTS` em `cs_lembretes_enviados`).
- **RPC `n8n_cs_lembretes_consulta_marcar_enviado(...)`** — insere em `cs_lembretes_enviados` (tipo='consulta', `ON CONFLICT DO NOTHING`).

#### Lembrete inteligente proactivo (cron diário 10h BRT — workflow id `X0fKnAX4moO1Zdhf`, ficheiro `n8n/workflow-lembretes-inteligentes.json`)
- **UI aba Lembretes — 2 blocos estruturados** (textarea livre de «sugestões» foi removida do UI; campo continua na BD por compat):
  - **⏰ Lembretes por procedimento**: lista das regras activas (`<Procedimento> → lembra após X meses` + botão Remover) + form de adicionar (dropdown só dos procedimentos sem regra + input meses + `+ Adicionar`). **+ Adicionar / Remover só alteram estado local** (`procedures` + `pendingProcChanges`) e marcam `dirty=true` — a gravação (`UPDATE clinic_procedures SET reminder_months = X|null WHERE id = ?`) só acontece no `handleSave` do botão **Salvar** do footer, em loop sobre `pendingProcChanges`. Auto-save foi removido (2026-05-28) para evitar gravações inesperadas. Feedback visual de sucesso: toast verde `✓ Alterações salvas com sucesso` no topo do painel (`absolute top-4`, duração 2.5s) + botão muda para `✓ Salvo` (emerald-700). Hover do Salvar muda para `emerald-600` (escurece) — sinaliza clicabilidade; quando `disabled` não reage ao hover.
  - **💌 Lembrete de saudades (opcional, fallback)**: **switch ON/OFF** explícito no topo do bloco. OFF → grava `lembrete_saudades_meses: null`, mostra «Desligado». ON → revela bloco explicativo + input «Lembrar após X meses sem visita» (default 8).
- **Coluna `clinic_procedures.reminder_months smallint NULL`** (migration `20260528190000`): meses após o último agendamento concluído desse procedimento para acionar lembrete. NULL = não envia.
- **RPC `n8n_cs_lembretes_inteligentes_candidatos()`** reescrita:
  - Para cada paciente da clínica activa, pega o **último agendamento concluído** (DISTINCT ON `clinic_id, cliente_id` ORDER BY `data DESC`).
  - Procura `clinic_procedures.reminder_months` por `lower(btrim(name))` igual a `lower(btrim(nome_procedimento))`.
  - Decide `tipo_lembrete`: `'procedimento'` se a regra do procedimento bateu (`meses_desde >= reminder_months`); `'saudades'` se nenhuma regra de procedimento bateu mas `lembrete_saudades_meses` está setado e bateu; senão `NULL` → paciente excluído.
  - **Top 50 por clínica** ordenados por `meses_desde DESC` (mais antigos primeiro) — protege o prompt do LLM e o n8n contra clínicas com milhares de candidatos.
  - Devolve por paciente: `cs_cliente_id, telefone, nome, tipo_lembrete, ultimo_procedimento, ultimo_profissional, ultima_data, meses_desde`. **NÃO devolve mais o array `historico[]`** — basta o último.
- **LLM** (`gpt-4o-mini`, `response_format: json_object`, credencial `OpenAi clinicas` id `v4dQPWdlMtUeGSD3`): só formata. Dois MODELOS rígidos:
  - **MODELO A** (`tipo_lembrete='procedimento'`): `Olá {PrimeiroNome}! Notamos que sua última {procedimento_minusculas} foi em {mês} de {ano}. Que tal agendar sua próxima manutenção? Estamos aqui para ajudar! 😊\n\nAtenciosamente, {nome_agente} da {clinic_name}.`
  - **MODELO B** (`tipo_lembrete='saudades'`): `Olá {PrimeiroNome}! Já faz {meses_desde} meses desde sua última visita. Sentimos sua falta! Está precisando de algo? Conte com a gente. 😊\n\nAtenciosamente, {nome_agente} da {clinic_name}.`
  - Tabela explícita de mês `01=janeiro…12=dezembro`. `{ano}` = `to_char(ultima_data, 'YYYY')`. Sem travessão antes do nome.
- **RPC `n8n_cs_lembretes_inteligentes_marcar(...)`** — throttle 20/clínica/dia + 30 dias/cliente. Retorna `false` se algum limite atingido (n8n descarta).

#### Defesas de escala (workflows n8n)
- **Batching no Evolution sendText**: `options.batching = { batch: { batchSize: 1, batchInterval: 1500 } }` — 1 msg a cada 1.5s no mesmo workflow run; respeita rate-limit Evolution e protege a instância de ban WhatsApp.
- **`onError: continueErrorOutput`** no Evolution: status≥400 sai pelo output `Error` (índice 1); só o branch `Success` (0) chega ao Marca enviado. Falhas (ex.: número não existe no WhatsApp → 400 com `exists:false`) **não marcam enviado** — próxima execução tenta de novo OU expira no throttle 30 dias.
- **No workflow `inteligentes`**: ordem é `Evolution → Reserva slot`. Se Evolution falhar, throttle não é gasto.

#### Tenant-safety
- **Tabela `cs_lembretes_enviados`** (idempotência): unique partial index `(clinic_id, cs_agendamento_id) where tipo='consulta'`; index para throttle smart por `(clinic_id, cs_cliente_id, enviado_at)`.
- **Helper `_clinic_aberta_agora(clinic_id)`** — usa `clinics.agenda_visible_hours`, `sabado_aberto`, `sabado_agenda_hours` em `America/Sao_Paulo`. Domingo sempre fechado.
- RPCs varrem todas as `clinics` activas (sem `clinic_id` hardcoded). Cada linha leva `clinic_id` + `instance_name` (`clinics.instancia_evolution`). `bot_ativo=false` no cliente e `agente_ativo=false` na clínica suprimem.
- Cada clínica tem o seu próprio `lembrete_mensagem` e `nome_agente`/`clinic_name`; mensagens são substituídas com os dados da clínica certa — sem cross-tenant.

#### UI auxiliar (admin avançado)
- **`web/src/components/agent-config-modal.tsx` (`ProceduresSectionInline`)** e **`web/src/components/procedures-manager-modal.tsx`**: ambos têm input `reminder_months` por procedimento (1-120 ou vazio). Mesma BD; só superfícies de edição alternativas. A aba Lembretes do `clinic-profile-panel.tsx` é a interface principal e recomendada para esta configuração.

### Limpeza periódica de chat memory
- **Workflow n8n `OwC7Y54kWZTB4Y1P`** ("Cleanup Chat Memory (90 dias)") roda diariamente às **3:30 BRT** chamando `rpc/n8n_cleanup_chat_histories(p_days: 90)`. Migration: `20260527164500_n8n_cleanup_chat_histories.sql`.
- A RPC apaga apenas sessões cuja **última msg seja anterior a 90 dias** (preserva sessões activas inteiramente). Não afecta `cs_clientes`/`cs_agendamentos`/`cs_clinic_directory` — apenas memória conversacional do LLM. Identidade do cliente e agendamentos persistem.
- Justificativa: chat memory antiga pode conter listas de profissionais já obsoletas (ex.: cliente que conversou há 6 meses tem nomes de profs que já saíram). MAPA ao vivo do Enrich sobrepõe, mas há risco residual de o LLM regurgitar memória antiga. Limpeza periódica reduz esse risco.
- Para mudar retenção: editar `jsonBody` do node `Call cleanup RPC` (alterar `p_days`). Para mudar horário: `cronExpression` no Schedule Trigger.

### Invalidação de chat memory ao alterar profissionais (migration `20260528170000`)
- **Problema:** em sessões com histórico forte (várias mensagens AI listando profissionais antigos), o LLM do agendador às vezes ignora o `## PROFISSIONAIS APTOS — DADOS AO VIVO` injectado pelo Enrich e reusa a lista da memória. O MAPA AO VIVO sozinho não basta para sessões muito carregadas.
- **Solução:** triggers automáticos no banco que apagam **apenas mensagens AI** que mencionem o profissional afectado quando ele muda no painel. Mensagens humanas e outras mensagens AI ficam intactas — preserva intenção do cliente e contexto.
- **`trg_professionals_invalidate_chat`** em `professionals`:
  - **DELETE** (hard) ou **UPDATE `is_active` true→false** (soft-delete via painel): apaga AI msgs da clínica que contenham o nome do profissional removido.
  - **UPDATE `name`**: apaga AI msgs com o nome antigo (para o LLM não continuar a chamar pelo nome obsoleto).
  - **INSERT** (profissional novo): apaga AI msgs da clínica que pareçam listas de profissionais (regex `profissionais (disponíveis|aptos|que realizam)`) — sem isso o LLM continuaria a oferecer a lista antiga sem o novo prof.
- **`trg_professional_procedures_invalidate_chat`** em `professional_procedures` (INSERT/UPDATE/DELETE): muda quem é apto a um serviço → apaga AI msgs da clínica com padrão de lista de profissionais (mesmo regex). Resolve o caso «vinculei um prof a Limpeza» / «desvinculei» sem precisar de DELETE manual.
- **Helper SQL:** `public._invalidate_chat_for_professional(p_clinic_id, p_professional_name)` — SECURITY DEFINER, normaliza nome (`btrim`), filtra por `session_id LIKE 'clinic_id:%'`, `message->>'type' = 'ai'`, `message::text ILIKE '%nome%'`. Devolve nº de linhas apagadas.
- **Tenant-safe:** filtro `session_id LIKE clinic_id::text || ':%'` — só apaga memória da clínica afectada. Outras clínicas não são tocadas.

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
  - `endereco`: morada da clínica (string livre, ex.: "Av. Jatobá, 55 - Centro") — salvo pela aba **Localização** do `clinic-profile-panel.tsx`
  - `latitude` / `longitude`: coordenadas decimais (number) para envio nativo de localização no WhatsApp — UI pede ao admin clicar com botão direito no Google Maps e copiar
  - ~~`link_localizacao`~~: campo removido do painel (2026-05-28). Substituído por `latitude`/`longitude` + sendLocation nativo. Painel salva `null` neste campo ao gravar; n8n ignora-o quando há coordenadas
  - ~~`outros`~~: campo removido do painel (dados legados no banco podem ainda existir mas não são exibidos)
- **`clinics.slot_duration_minutes smallint NOT NULL DEFAULT 60`** (migration `20260526240000`): duração padrão dos slots da clínica inteira (15/30/60 min). Usado no painel `clinic-agenda-hours-modal.tsx` para gerar a grade visual de sub-slots (ex: 30 min → 08:00, 08:30, 09:00…). Cada profissional pode ter o seu próprio `slot_duration_minutes` que sobrepõe o da clínica.
- `cs_clientes`, `cs_agendamentos`, slots, serviços, profissionais — tudo filtrado por `clinic_id`
- Ao criar RPCs novas, sempre receber `p_clinic_id uuid` como primeiro parâmetro

### ⚠️ Caminho de resolução da clínica (resolve path) — campos e nós mortos (fix 2026-07-08)
O fluxo ao vivo **não** usa mais `Buscar Config Cl?nica` no caminho principal. A clínica é resolvida por um **resolve path**:

`Webhook → Filter1 → Edit Fields1 → Code Normalizar Evolution Clinica → IF evento e mensagem → HTTP RPC n8n_resolve_clinic → Code merge webhook e resolucao → Switch assinatura e acesso → IF Agente Ativo → Check First Contact → Monta Contexto → agentes → Edit Fields → dispatch Evolution`

- **A RPC `n8n_resolve_clinic` / `Code merge webhook e resolucao` devolve os campos com prefixo `clinica_`:** `clinica_id`, `clinica_ativa`, `clinica_nome`, `agent_instructions`, `tipo_plano`, `data_expiracao`, `inadimplente` — **NÃO** `id`/`ativo`/`name`. Qualquer nó no caminho principal que ler `$json.id`/`$json.ativo`/`$json.name` recebe `undefined`.
- **`Switch assinatura e acesso`** por isso lê com fallback: `clinica_nao_encontrada` = `{{ ($json.clinica_id ?? $json.id) ?? '' }}` vazio; `cond-pe-ativo-false` = `{{ $json.clinica_ativa ?? $json.ativo }}`. **Bug histórico (resolvido 2026-07-08):** lia só `$json.id`/`$json.ativo` → como o merge entrega `clinica_id`, o `id` ficava vazio e **TODAS** as mensagens caíam em `clinica_nao_encontrada → NoOp` (bot mudo para todas as clínicas). Sintoma: execuções «success» com só ~10 nós, morrendo no Switch.
- **Nós MORTOS (não executam no caminho principal): `Buscar Config Cl?nica` (alimentado só por `Edit Fields2 ← ResetaFila`, ramo da fila Redis que não roda) e `Edit Fields2`.** Nunca referenciar `$('Buscar Config Cl?nica')` nem `$('Edit Fields2')` a partir de nós do caminho principal — dá erro «Node '…' hasn't been executed» (ex.: `Edit Fields` final travava em `$('Edit Fields2').item.json.ConversationID`; corrigido para `$('Webhook').first().json.body?.data?.key?.remoteJid`).
- **`Monta Contexto`** lê a config da clínica com fallback: tenta `$('Buscar Config Cl?nica')` (morto → catch) e cai em **`$('IF Agente Ativo').first().json`** (2 hops atrás, dentro do limite do task-runner; o item carrega `clinica_nome`/`agent_instructions` do merge). `clinic_name = clinicRaw.name || clinicRaw.clinica_nome`. **⚠️ Não usar `$('Code merge webhook e resolucao')` a partir de Monta Contexto** — são 4 hops e o task-runner n8n 2.10.x falha em `$('node')` 3+ hops atrás → config viria vazia (respostas sem nome da clínica).
- Fixes aplicados via API (activeVersion é read-only no PUT público — só o bloco `nodes[]` top-level é enviado; o n8n regenera `activeVersion` no activate). Manter `workflow-kCX2-live.json` em sync com ambos os blocos.

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
- **Início da mensagem — proibido preâmbulo (secção `## INÍCIO DA MENSAGEM — PROIBIDO PREÂMBULO` no SM, adicionada 2026-05-28):** a primeira frase da resposta **nunca** pode ser "Vou verificar/consultar/buscar/checar…", "Um momento", "Aguarde", "Deixa eu ver…". Vai direto à informação. Esta regra vale **mesmo quando o preâmbulo é seguido pela info correta na mesma mensagem** — a regra de `## ERROS DE TOOL` cobre só o caso de falha; esta cobre o caso de sucesso (LLM tende a usar o preâmbulo como decoração). Patch: `n8n/patch-agendador-sm-no-preamble.mjs`.
- **Horários — proibido usar memória (secção `## HORÁRIOS — PROIBIDO USAR MEMÓRIA` no SM, adicionada 2026-05-28):** o LLM tende a reusar horários listados em mensagens anteriores da conversa quando o cliente pede para reagendar. Esses horários PODEM JÁ TER PASSADO (ex.: às 14h listou "14:00, 14:30, 16:00, 17:30"; quando o cliente responde às 17:08 e pede "para as 18:00", o LLM, ao receber `horario_indisponivel`, listou "14:00, 14:30, 16:00, 17:30" da memória — todos os 3 primeiros já passados). Regra: ANTES de listar qualquer horário (agendar ou reagendar) chamar SEMPRE `agd_cs_consultar_vagas` com a data alvo + `profissional_id`; usar APENAS o resultado fresh. A RPC `n8n_cs_consultar_vagas` já filtra `h.horario >= now()::time` para `p_data = CURRENT_DATE` — o bug é puramente comportamental no LLM. Patch: `n8n/patch-agendador-sm-no-memory-slots.mjs`.
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
- **⚠️ ARMADILHA n8n HTTP Request + Supabase RPC — DOIS formatos possíveis** (corrigido 2026-05-28):
  - **(a) Array unwrapped:** body = `[{...}, {...}, ...]` → n8n fragmenta em N itens (1 por elemento). `$input.all().map(i => i.json)` no Relay reconstrói o array.
  - **(b) Objecto wrapper:** body = `{"n8n_cs_profissionais_para_agente": [...]}` → n8n **NÃO fragmenta** (top-level é objecto). Fica 1 único item com o array dentro. Foi o caso observado e a causa raiz do bug «Paula não aparece» (2026-05-28).
  - **Defesa no Enrich Agendador** (patch `n8n/patch-enrich-unwrap-prof-rpc.mjs`): após `httpProfArr = $input.all()...`, se `httpProfArr.length === 1` e o único item NÃO tem `id`/`nome` → desempacotar 1 nível procurando o primeiro `Object.values` que seja array de objectos com `id` ou `nome`. Cobre ambos os casos.
  - Bug histórico (2026-05-27, caso (a)): Relay capturava só o Camilo. Bug (2026-05-28, caso (b)): MAPA vazio, agendador caía na memória de chat antiga (lista de 3 profs, faltava Paula).
- **Enrich não chama `parseProfissionaisRpc` para `_httpProf`**: depois do desempacotamento defensivo acima, o array está em formato correcto (objectos com `id`, `nome`, `especialidade`, `procedimento_ids`). Usar `profs = httpProfArr.filter(p => p && p.id && p.nome)`. **Não passar pelo `extractSupabaseArray` recursivo** — essa função recursa em `Object.values` e pode devolver o array `procedimento_ids` do primeiro prof como se fossem os profissionais, causando profBlock com `?`/`undefined` e sem MAPA.
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

### Antecedência mínima de agendamento (migration `20260530120000`)
- **`clinics.agent_instructions->>'antecedencia_minima_minutos'`** (default `30`) define a janela mínima entre `now()` e o horário do agendamento que o **agente WhatsApp** pode marcar / reagendar / cancelar. Configurado no painel: **Clínica/Perfil → aba Dados → Antecedência mínima de agendamento** (`<select>` 15/30/60/120/240/720/1440 min).
- **Helper `public._clinic_antecedencia_minutos(p_clinic_id uuid)`** — STABLE, lê o JSON, devolve `int`. Reutilizado pelas 4 RPCs.
- **`n8n_cs_consultar_vagas`** — para `p_data = CURRENT_DATE`, `v_cutoff_time := (NOW() + antec)::time` (em `America/Sao_Paulo`). Não mostra slots dentro da janela. Para outras datas o cutoff fica `00:00`.
- **`n8n_cs_agendar` / `n8n_cs_reagendar` (`p_mutacao_origem='agente'`) / `n8n_cs_cancelar`** — devolvem `{ ok: false, error: 'antecedencia_minima', antecedencia_minutos: X, message: ... }` se o alvo estiver dentro da janela. Reagendamentos pelo **painel** (`p_mutacao_origem='painel'`) ignoram a regra — staff pode sempre reagendar. Cancelamentos pelo painel não passam por `n8n_cs_cancelar` (usam `painel_cancel_cs_agendamento`), portanto também não são afectados.
- **Agente WhatsApp (system message do `agente_agendador`, secção `## ANTECEDÊNCIA MÍNIMA`)** — quando recebe `error: 'antecedencia_minima'`, responde com o número de minutos devolvido e orienta o cliente a contactar a clínica directamente. Não tenta outra vez nem inventa horário. Patch: `n8n/patch-agendador-sm-antecedencia.mjs`.
- **Tenant-safe:** cada chamada usa o `clinic_id` que já recebe (consultar_vagas/agendar/reagendar via primeiro arg ou lookup pelo profissional/agendamento). Sem hardcode.

### Agendar vs reagendar (duplicados na grade)
- Se o cliente **já** tem consulta activa com o **mesmo** profissional na **mesma** data, `n8n_cs_agendar` responde `ok: false`, `error: ja_existe_agendamento_mesmo_dia` e devolve `agendamento_id` — usar **`n8n_cs_reagendar`** com esse id. Chamar `cs_agendar` de novo cria um **segundo** `cs_agendamentos` e o painel mostra dois horários «AGEND.».
- `n8n_cs_reagendar` liberta o slot antigo com `date_trunc('minute', horario)` e cancela duplicados órfãos no slot antigo após mover o registo principal.
- **Overload único (migration `20260528200000`):** existia uma versão antiga de 7 parâmetros (sem `p_mutacao_origem`) ao lado da versão de 8 parâmetros (`p_mutacao_origem DEFAULT 'agente'`). PostgREST não conseguia resolver qual chamar quando o n8n enviava 7 params → erro → agente improvisava «houve um problema ao reagendar». A versão antiga foi removida; só existe a de 8 parâmetros agora.

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

### Endereço da clínica & localização nativa no WhatsApp
- **UI** (`clinic-profile-panel.tsx` → aba **Localização**): campos `Endereço` (texto livre) + `Latitude`/`Longitude` (decimais). Caixa de instruções ensina admin a clicar com botão direito no Google Maps (link clicável para `https://www.google.com/maps`) e copiar coordenadas no formato `-8.0476, -34.8770`. Sem coordenadas → bot não envia card nativo (e como `link_localizacao` foi removido, simplesmente não tem como mostrar mapa). Botão `Conferir ponto exacto no Maps` abre `google.com/maps?q=lat,lng` para validar.
- **`Monta Contexto`** (Code node n8n, patch `n8n/patch-monta-contexto-endereco.mjs`): extrai de `clinics.agent_instructions` os campos `endereco`, `latitude`, `longitude`, e expõe no contexto: `loc_latitude`, `loc_longitude`, `loc_name` (= `clinic_name`), `loc_address` (= `endereco`), `loc_has_native` (boolean). Também injecta no `instr_faq` o bloco `### ENDERECO DA CLINICA` com:
  - se `loc_has_native = true` (lat/lng preenchidos): instrui o `agente_faq` a responder em **uma frase curta** confirmando o endereço e adicionar **`[SEND_LOCATION]` na última linha**. Proíbe markdown e link manual — o card nativo substitui.
  - se `loc_has_native = false` (sem coordenadas): instrui a responder com `Endereco: ...` (sem link, já que `link_localizacao` foi removido do painel; só fica este texto).
- **`Edit Fields`** (n8n set node): expressão de `answer` faz `.replace(/\s*\[SEND_LOCATION\]\s*/gi, '')` para remover o marker do texto que vai ao cliente. Campo adicional `_send_location` (boolean) = `/\[SEND_LOCATION\]/i.test($json.output)`.
- **Branch `If Send Location` → `Evolution sendLocation`** (ids: `send-loc-if-v1`, `send-loc-evolution-v1`, patch `n8n/patch-send-location-branch.mjs`): ligado em **paralelo** ao ramo de texto (Edit Fields → Quebra a mensagem). Quando `_send_location = true`, chama `POST https://evolutionapi.../message/sendLocation/{instance}` com `{ number, latitude, longitude, name, address }` lidos de `$('Monta Contexto').first().json.loc_*`. `onError: continueErrorOutput` → falha não derruba a resposta de texto.
- **Tenant-safe:** lat/lng/endereço lidos de `clinics.agent_instructions` da clínica resolvida pelo `instance_name` em `Buscar Config Cl?nica`. Sem hardcode; cada clínica tem o seu próprio card.
- **Fluxo runtime:** cliente pergunta "onde fica?" → qualificador `[ROTA: faq]` → `agente_faq` responde `"A {clinic_name} fica em {endereco}.\n[SEND_LOCATION]"` → Edit Fields strip marker + setta flag → em paralelo o texto vai pelo dispatch normal **e** o sendLocation envia o card nativo do WhatsApp (com nome+endereço sob o pin).
- **Dispatch — bug do sendMedia** (corrigido 2026-05-28, patch `n8n/patch-if-imagem-regex.mjs`): o node `If` (id `24555f4d-a6ef-49e4-bf7c-4a065bc32b20`) que decide entre `Evolution API` (sendText) e `Evolution API1` (sendMedia) usa **regex** `https?:\/\/[^\s]+?\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?` em `$json.answer`. Antes era `contains "https"` — qualquer link (ex.: Google Maps) disparava o ramo de imagem, o Code seguinte só extrai URL terminada em extensão de imagem → `imagem: null` → Evolution `sendMedia` 400 Bad Request. Se voltar a aparecer este erro, re-rodar o patch.

### Notificação de profissionais
- O workflow tem **Code auto-notify profissional** (após o agendador): chama `n8n_cs_profissional_whatsapp_mudanca_recente` quando a resposta parece mutação; usa só dígitos no telefone; janela de «mudança recente» **25 min** no Supabase. O texto inclui **telefone do cliente**: tenta `cs_agendamentos.cliente_id` → `cs_clientes.telefone` (GET); fallback para `ctx.remoteJid` (número da conversa, sempre disponível) se a query não resolver.
- **Formato das mensagens** (padrão unificado em `professional-notify-message.ts` e Code node): cabeçalho `{Dr/Dra Nome}, você tem um …:` → linha em branco → indicador de tipo (`🟢 Novo agendamento` / `🟡 Reagendamento` / `🔴 Cancelamento`) → linha em branco → campos com emojis: `👤 Cliente`, `📱 Telefone`, `📌 Serviço`, `📅 Data`, `🕒 Horário`. Mensagem ao cliente segue o mesmo padrão (sem linha de cliente/telefone).
- O system message do agendador diz para **não** chamar `agd_cs_notificar_profissional` — o fluxo notifica via este Code node quando a RPC devolve `profissional_whatsapp`.
- O `profissional_whatsapp` vem das RPCs via `LEFT JOIN professionals ON cs_profissional_id = cs_profissionais.id`
- O campo `professionals.whatsapp` (e resto do cadastro) é configurado no painel — **UI** em `professionals-manager-modal.tsx` está descrita na secção **Profissionais (dual-table)** acima
- Se o profissional não tiver WhatsApp cadastrado, `profissional_whatsapp` retorna `null` e a notificação é pulada silenciosamente
- O node tool `agd_cs_notificar_profissional` existe no workflow mas o comportamento pretendido é notificação automática no fluxo (Evolution), não depender do LLM para esse passo
- **Painel Next.js (Evolution):** `web/src/lib/professional-notify-message.ts` formata novo / reagendar / cancelar com linha **📱 Telefone** do cliente quando `clienteTelefone` / `patients.phone` / RPC `painel_cancel_cs_agendamento` (`cliente_telefone`, migration `20260427220000_painel_cancel_cliente_telefone.sql`) / webhook `web/src/app/api/webhooks/cs-agendamento-notify/route.ts` (lê `cs_clientes.telefone`). Rota `POST /api/whatsapp/notify-professional` envia o texto. Sincronização em tempo real na agenda: `fireNotifyProfessionalFromAgendaDiff` em `painel-notify-professional.ts`.

### Trial 7 dias + corte de acesso por assinatura
- **`clinics.data_expiracao date NULL`** + **`clinics.tipo_plano text` / `clinics.ativo boolean` / `clinics.inadimplente boolean`**: definem se a clínica está em trial vencido, plano mensal vencido / bloqueada, ou activa.
- **Trial padrão** = 7 dias (`TRIAL_DURATION_DAYS` em [web/src/lib/trial.ts](web/src/lib/trial.ts)). Aplicado automaticamente ao registo (`bootstrap-clinic.ts`) e ao trocar plano via `/api/clinica/[id]/assinatura`. Backfill em `20260529145424_backfill_trial_expiry.sql` cobriu clínicas legadas que estavam com `data_expiracao = NULL`.
- **Admin sistema gere via UI** em `/admin/clinicas` ([admin-clinics-table.tsx](web/src/app/admin/_components/admin-clinics-table.tsx)): input de data + botões «Salvar data», «Trial 7d» (reset para hoje+7), «+30d», «Desativar/Reativar», «Regularizar». Backend: `PATCH /api/admin/clinicas` ([route.ts](web/src/app/api/admin/clinicas/route.ts)) — só system admin (env `SYSTEM_ADMIN_EMAILS`).
- **Acesso ao admin de plataforma** (separado do `/painel`): login dedicado em `/login/admin`, dashboard em `/admin` ([web/src/app/admin/](web/src/app/admin/)). Autenticação é a mesma Supabase Auth dos donos de clínica; autorização exige email/UUID em `SYSTEM_ADMIN_EMAILS`/`SYSTEM_ADMIN_USER_IDS` ([system-admin.ts:14-26](web/src/lib/system-admin.ts#L14-L26)) — múltiplos emails separados por vírgula. Login normal (`/login`) redireciona sempre para `/painel`; para entrar no admin tens de **navegar manualmente** para `/admin` ou começar em `/login/admin`. Alterar env exige reiniciar `npm run dev` (e redeploy na Vercel). Owner único da Clínica Saúde = `felipeari2007@gmail.com`.
- **Corte no agente WhatsApp (n8n):**
  - `Buscar Config Cl?nica` traz `tipo_plano, data_expiracao, ativo, inadimplente` (além de `agente_ativo`).
  - **`Switch assinatura e acesso`** vem **antes** de `IF Agente Ativo`. 4 saídas:
    - `clinica_nao_encontrada` (`id` vazio) → NoOp silencioso.
    - `teste_expirado` (`tipo_plano='teste'` + `data_expiracao < hoje America/Sao_Paulo`) → `HTTP marca aviso teste` (RPC throttle) → `IF deve avisar teste` (TRUE → `Evolution aviso teste` → NoOp; FALSE → NoOp).
    - `plano_expirado` (data vencida não-teste OR `ativo=false` OR `inadimplente=true`) → ramo análogo `Evolution aviso mensal`.
    - `ativo` (fallback) → `IF Agente Ativo` (fluxo normal).
  - Texto fixo nos sendText (configurável depois em `clinics.agent_instructions` se necessário).
- **Throttle 1x/sessão:** RPC `n8n_cs_bloqueio_aviso_marcar(p_clinic_id, p_phone)` (migration `20260529150920_bloqueio_aviso_throttle.sql`) usa `whatsapp_sessions.bloqueio_avisado_em`. Usa `clock_timestamp()` (não `now()`, que é o timestamp da transação — bug original detectado em teste). Devolve `true` na primeira chamada da sessão, `false` nas seguintes. Cliente recebe o aviso de bloqueio uma vez só por sessão WhatsApp.
- **Reset automático ao renovar:** trigger `trg_clear_bloqueio_aviso_on_clinic_renew` em `clinics` limpa `bloqueio_avisado_em` de **todas as sessões da clínica** quando admin avança `data_expiracao`, volta `ativo` a true ou `inadimplente` a false. Próxima mensagem dos clientes volta a fluir normal sem aviso residual.
- **Tenant-safe:** Switch lê `clinic_id` (`$json.id` do Buscar Config Cl?nica) → RPC recebe-o. Trigger filtra `WHERE clinic_id = NEW.id`. Sem hardcode.
- **Painel web:** expiração só bloqueia CRM hoje ([middleware.ts:73-94](web/src/lib/supabase/middleware.ts#L73-L94)); o `/painel` continua acessível para o dono ver o status «Vencido» e o banner «Falar com suporte» ([clinic-subscription-panel.tsx:213](web/src/components/clinic-subscription-panel.tsx#L213)). Bloqueio real do painel = admin meter `ativo=false`.
- **Aviso 3 dias antes** (migration `20260529152911_expiry_warning_3d.sql`):
  - **Modal canto inferior direito** ([web/src/components/expiry-warning-modal.tsx](web/src/components/expiry-warning-modal.tsx)) — aparece sempre que `data_expiracao - hoje ≤ 3`. Dismissível com persistência em `localStorage` por dia + (`clinic_id, data_expiracao`).
  - **`clinics.admin_whatsapp`** (text, só dígitos) — campo opcional para receber avisos administrativos. Fallback automático para `clinics.phone`. UI no painel `/painel?page=clinic-subscription` (secção «WhatsApp administrativo»).
  - **Workflow n8n `9fmkFzozzDl9rfCV` («Aviso Vencimento Plano (3 dias antes)»)** — cron diário **10h BRT** chama `n8n_cs_clinics_avisar_vencimento(3)`. Para cada clínica devolvida (Evolution sendText → marca em `cs_expiry_avisos_enviados`). Idempotência por `(clinic_id, data_expiracao_alvo, dias_antes)`.
  - Tenant-safe: RPC itera todas as clínicas activas com `data_expiracao = CURRENT_DATE + 3` sem hardcode. WhatsApp vai sempre pelo `instance_name` da clínica afectada.
  - Para estender (1d, 0d, ou planos mensais): chamar a mesma RPC com outro `p_dias_antes` ou duplicar o workflow.

### Tracking de custo IA por clínica + orçamento OpenAI (migration `20260529160000`, `20260529170000`)
- **Tabela `ai_usage_logs`** (migration `20260529160000_ai_usage_logs.sql`): `clinic_id`, `agent` (`qualificador|agendador|faq|especialista|lembretes|whisper|vision`), `model` (`gpt-4o-mini|whisper-1|gpt-4o`), `prompt_tokens`, `completion_tokens`, `total_tokens` (generated), `cost_usd numeric(12,6)`, `created_at`. RLS on, só RPCs SECURITY DEFINER acedem.
- **RPC `n8n_ai_usage_log(p_clinic_id, p_agent, p_model, p_prompt_tokens, p_completion_tokens, p_cost_usd)`** chamada pelo n8n (`anon, authenticated, service_role` podem executar). Valida que `clinic_id` existe; clamps negativos a 0; defaults para `desconhecido` se agente/modelo vier vazio.
- **RPC `admin_ai_usage_per_clinic()`** (service_role): por `clinic_id`, devolve `cost_mes_atual_usd`, `cost_total_usd`, `tokens_mes_atual`, `tokens_total`, `chamadas_mes_atual`, `chamadas_total`, `ultima_chamada_at`. Janela do mês = `date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')`.
- **RPC `admin_ai_usage_breakdown(p_clinic_id, p_periodo)`** (service_role, `p_periodo ∈ 'mes'|'total'`): agrupa por `agent`, devolve `chamadas`, tokens, `cost_usd`, modelo mais usado (via `MODE() WITHIN GROUP`). Ordenado por `cost_usd DESC`.
- **n8n — patch `patch-ai-usage-logging.mjs`** (workflow `kCX2LfxJrdYWB0vk`): para cada um dos 4 agentes de texto (`agente_atende_qualifica`, `agente_agendador`, `agente_faq`, `agente_especialista_procedimentos`) adiciona uma **branch paralela** `agente → Log AI Usage X (Code) → HTTP Log AI Usage X (Supabase RPC)`. As ligações originais ficam intactas (sem rewire da main pipeline) — logging é best-effort e nunca bloqueia a resposta. Code node tenta múltiplos paths para `tokenUsage` (`$('Chat Model X').all()` com fallbacks para `usage`, `response.llmOutput.tokenUsage`, `response.generations[0][0].generationInfo.tokenUsage`) e cai num estimador char-based (`~4 chars/token`) se nada funcionar. Preços hardcoded: gpt-4o-mini `$0.150/M input + $0.600/M output`. Ambos os nodes têm `onError: continueRegularOutput`. **Whisper/Vision e lembretes inteligentes ainda não estão instrumentados** (HTTP nodes directos, estrutura diferente) — TODO se necessário.
- **Tabela `platform_settings`** (migration `20260529170000_platform_settings_and_ai_budget.sql`): `key text PK`, `value jsonb`, `updated_at`. Linha default `('openai_budget', {budget_usd: 0})`. Genérica — pode receber outras settings da plataforma.
- **RPC `admin_ai_budget_status()`** (service_role): devolve `budget_usd`, `spent_total_usd`, `spent_mes_atual_usd`, `remaining_usd` (clamped a 0), `pct_used` (clamped a 999, 1 casa decimal), `updated_at` do setting.
- **RPC `admin_set_ai_budget(p_budget_usd numeric)`** (service_role): upsert do `openai_budget`. Valida `>= 0`.
- **Painel admin (`/admin/clinicas`):**
  - **Coluna «Custo IA»** (entre Plano e Expira) em [admin-clinics-table.tsx](web/src/app/admin/_components/admin-clinics-table.tsx): mostra mês (USD · BRL) + total acumulado em baixo + botão **«Detalhes»** que abre [admin-clinic-ai-usage-modal.tsx](web/src/app/admin/_components/admin-clinic-ai-usage-modal.tsx) com breakdown por agente (toggle «Este mês» / «Total»). Endpoint `GET /api/admin/clinicas/[id]/ai-usage?periodo=mes|total`. `min-width` da tabela subiu para 1300px para caber a coluna.
  - **Card «Saldo OpenAI»** (acima da tabela) em [admin-ai-budget-card.tsx](web/src/app/admin/_components/admin-ai-budget-card.tsx): valor restante em destaque (USD · BRL), gasto total + mês + % do orçamento, barra de progresso (verde <70%, âmbar 70-90%, vermelha >90%), botão **«Editar orçamento»** com input inline. Endpoint `GET/PUT /api/admin/ai-budget`.
- **Cotação USD→BRL**: env var **`USD_BRL_RATE`** (default 5.50) lida server-side em `getUsdBrlRate()` em [clinics-data.ts](web/src/lib/admin/clinics-data.ts). Conversão é simples multiplicação no server antes de enviar para o cliente. Actualizar em `.env.local` quando o dólar mudar significativamente.
- **OpenAI dashboard externo:** saldo real prepago em https://platform.openai.com/settings/organization/billing/overview; uso detalhado em https://platform.openai.com/usage; limites/alertas em https://platform.openai.com/settings/organization/limits (definir Usage Limit ligeiramente abaixo do orçamento do painel para corte automático).
- **Tenant-safe:** RPC de insert usa `clinic_id` resolvido pelo `Buscar Config Cl?nica` (via `instancia_evolution`) — sem hardcode no Code node. RPCs de agregação são gated por service_role (endpoints Next só callable via `requireSystemAdmin`).

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
- **`Filter1`** (webhook → fluxo principal): condições em AND — `event === 'messages.upsert'` (só no bloco top-level), `fromMe === false` E **`remoteJid notEndsWith '@g.us'`** (skip grupos, adicionado 2026-05-29 — agente nunca responde em grupos, independente de `clinics.agente_ativo`). Condição de teste com número fixo `558196454656` foi removida. ⚠️ aplicar nos **dois** blocos `nodes[]` e `activeVersion.nodes[]` ao mexer.

### Tags de conversas (inbox WhatsApp) — só no painel
- **Migration `20260708153000_cs_tags_conversas.sql`:** duas tabelas isoladas por clínica (RLS `rls_has_clinic_access(clinic_id)`):
  - **`cs_tags`** (catálogo por clínica): `id`, `clinic_id`, `label`, `color` (chave da paleta: `red|amber|green|teal|blue|purple|pink|slate`), `created_at`, `updated_at`. Unique `(clinic_id, lower(btrim(label)))`.
  - **`cs_cliente_tags`** (atribuição N:N conversa↔tag): `id`, `clinic_id`, `cs_cliente_id` (FK `cs_clientes` on delete cascade), `tag_id` (FK `cs_tags` on delete cascade), `created_at`. Unique `(clinic_id, cs_cliente_id, tag_id)`.
- **⚠️ NÃO sincronizam com o WhatsApp do celular** — as etiquetas nativas do WhatsApp Business são fechadas e a Evolution API não permite gravá-las. As tags são cosméticas/organizacionais **só no painel**.
- **UI (`web/src/components/whatsapp-inbox.tsx`):** botão de etiqueta no cabeçalho do chat abre popover para marcar/desmarcar tags do cliente selecionado, **criar novas** (nome + cor) ou usar **sugestões pré-definidas** (`TAG_PRESETS`: Urgente, Cliente novo, Retorno, Aguardando pagamento, Agendado, Sem resposta — criadas sob demanda, nada é semeado na BD). Pílulas coloridas aparecem na lista de conversas e no topo do chat; barra de **filtro por tag** acima da lista. Paleta central em `TAG_COLORS`. As atribuições ligam-se por `cs_clientes.id` — o inbox agora carrega `id` no select de `cs_clientes` e propaga `clienteId` em `SessionInfo` (load + realtime). Mutations são optimistas com revert em erro.
- **Tenant-safe:** todas as queries filtram `clinic_id`; RLS garante isolamento. Conversas cujo telefone ainda não bate com nenhum `cs_clientes` (`clienteId` null) não podem receber tag até o cliente ser criado.

### UI painel — melhorias de navegação e conveniência (2026-07-08)
- **Olho de mostrar/ocultar senha:** ícones `IconEye`/`IconEyeOff` em `web/src/components/auth/auth-icons.tsx`; toggle nos campos de senha de `clinic-login-form.tsx` e `admin-login-form.tsx` (a tela `redefinir-senha/page.tsx` já tinha o seu próprio `EyeIcon`). `tabIndex={-1}` no botão para não atrapalhar o Tab.
- **Inbox em tela cheia (`whatsapp-inbox.tsx`):** estado `fullscreen` + botão de expandir/recolher no cabeçalho da lista. Em tela cheia o container raiz vira `fixed inset-0 z-[200]` (escapa da sidebar) e trava o scroll do `body`; `Esc` sai (a menos que o menu do cabeçalho esteja aberto).
- **Grupo «Atendimento» na sidebar (`agenda-portal.tsx`):** botão colapsável que agrupa **Inbox WhatsApp → Clientes → WhatsApp humano** (nessa ordem). Estado `waGroupOpen`; `waGroupActive` = uma das 3 páginas activa; `waGroupExpanded = waGroupOpen || waGroupActive` (abre-se sozinho quando uma sub-página está activa). O badge da fila humana (`humanQueueCount`) aparece no botão-pai quando recolhido. **Agente IA fica FORA do grupo**, como item próprio logo abaixo. Aplicado nos dois renders (sidebar desktop + drawer mobile).
- **Busca de endereço → lat/long automáticos (`clinic-profile-panel.tsx`, aba Localização):** input «🔎 Buscar endereço no mapa» com autocomplete via **OpenStreetMap/Nominatim** (`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=br&accept-language=pt-BR&q=…`) — **sem chave de API**, debounce 600 ms + `AbortController`, mínimo 4 caracteres. Ao escolher um resultado preenche `enderecoClinica`, `latitude`, `longitude` (6 casas). Campos manuais de coordenadas permanecem como fallback/ajuste fino. Para precisão/autocomplete do Google seria preciso uma Google Maps API key (paga). Não há CSP no `next.config.ts` a bloquear o domínio.

### Identificação de cliente novo vs retorno
- `cs_clientes.nome` = vazio (`''`) → nunca confirmou o nome → **cliente novo**
- `cs_clientes.nome` = preenchido → nome confirmado via `cs_salvar_nome` → **cliente de retorno**
- `Create Cliente` sempre cria com `nome = ''` (DEFAULT `''` no banco)
- NÃO salvar `pushName` do WhatsApp como nome — é nome do WhatsApp, não confirmado
