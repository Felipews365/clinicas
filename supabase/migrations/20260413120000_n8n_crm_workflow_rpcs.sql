-- n8n CRM: RPCs multi-tenant para WhatsApp touch, listagem diária, rotina por clínica; CRM pós-agendar.

-- ---------------------------------------------------------------------------
-- 1. Toque WhatsApp: update condicional + interação (sempre por clinic_id)
-- ---------------------------------------------------------------------------
create or replace function public.n8n_crm_whatsapp_touch(
  p_clinic_id uuid,
  p_telefone text,
  p_resumo text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_tel text;
  v_cliente_id uuid;
  v_updated int;
  v_resumo text;
begin
  if p_clinic_id is null then
    return jsonb_build_object('ok', false, 'error', 'clinic_id_required');
  end if;

  if not public.crm_clinic_has_access(p_clinic_id) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_crm_access');
  end if;

  v_tel := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  if v_tel = '' then
    return jsonb_build_object('ok', false, 'error', 'telefone_required');
  end if;

  v_resumo := left(trim(coalesce(p_resumo, '')), 200);

  select c.id into v_cliente_id
  from public.cs_clientes c
  where c.clinic_id = p_clinic_id
    and c.telefone = v_tel;

  if v_cliente_id is null then
    return jsonb_build_object('ok', false, 'error', 'cliente_not_found');
  end if;

  update public.cs_clientes c
  set
    data_ultimo_contato = now(),
    status_funil = 'atendido'::public.crm_status_funil
  where c.clinic_id = p_clinic_id
    and c.id = v_cliente_id
    and c.status_funil in (
      'lead'::public.crm_status_funil,
      'agendado'::public.crm_status_funil
    );

  get diagnostics v_updated = row_count;

  insert into public.crm_interacoes (clinic_id, cliente_id, tipo, resumo)
  values (p_clinic_id, v_cliente_id, 'whatsapp', v_resumo);

  return jsonb_build_object(
    'ok', true,
    'cliente_id', v_cliente_id,
    'crm_status_updated', v_updated > 0
  );
end;
$$;

comment on function public.n8n_crm_whatsapp_touch(uuid, text, text) is
  'n8n: após identificar cliente (clinic_id + telefone), CRM touch + registo whatsapp em crm_interacoes.';

revoke all on function public.n8n_crm_whatsapp_touch(uuid, text, text) from public;
grant execute on function public.n8n_crm_whatsapp_touch(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Listar clínicas elegíveis para job diário CRM
-- ---------------------------------------------------------------------------
create or replace function public.n8n_crm_list_daily_eligible_clinics()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', cl.id,
        'instance_name', w.instance_name,
        'crm_reengagement_message', cl.crm_reengagement_message
      )
      order by cl.id
    ),
    '[]'::jsonb
  )
  from public.clinics cl
  inner join public.clinic_whatsapp_integrations w on w.clinic_id = cl.id
  where cl.ativo is true
    and public.crm_clinic_has_access(cl.id);
$$;

comment on function public.n8n_crm_list_daily_eligible_clinics() is
  'n8n: clínicas ativas com acesso CRM (teste/enterprise/plan_tem_crm) para rotina diária.';

revoke all on function public.n8n_crm_list_daily_eligible_clinics() from public;
grant execute on function public.n8n_crm_list_daily_eligible_clinics() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Rotina diária por clínica (isolamento explícito por p_clinic_id)
-- ---------------------------------------------------------------------------
create or replace function public.n8n_crm_daily_clinic_run(p_clinic_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_tasks int := 0;
  v_candidates jsonb;
  v_inst text;
  v_msg text;
begin
  if p_clinic_id is null then
    return jsonb_build_object('ok', false, 'error', 'clinic_id_required');
  end if;

  if not public.crm_clinic_has_access(p_clinic_id) then
    return jsonb_build_object('ok', true, 'skipped', true, 'clinic_id', p_clinic_id);
  end if;

  select w.instance_name, cl.crm_reengagement_message
  into v_inst, v_msg
  from public.clinics cl
  left join public.clinic_whatsapp_integrations w on w.clinic_id = cl.id
  where cl.id = p_clinic_id;

  -- 90d → sumido (antes do passo 60d)
  update public.cs_clientes c
  set
    status_funil = 'sumido'::public.crm_status_funil,
    status_relacionamento = 'sumido'::public.status_relacionamento
  where c.clinic_id = p_clinic_id
    and (
      c.ultima_consulta is null
      or c.ultima_consulta < (current_date - interval '90 days')
    )
    and c.status_funil is distinct from 'sumido'::public.crm_status_funil;

  -- 60d → inativo (nunca sobrescrever sumido)
  update public.cs_clientes c
  set
    status_funil = 'inativo'::public.crm_status_funil,
    status_relacionamento = 'inativo'::public.status_relacionamento
  where c.clinic_id = p_clinic_id
    and (
      c.ultima_consulta is null
      or c.ultima_consulta < (current_date - interval '60 days')
    )
    and c.status_funil is distinct from 'sumido'::public.crm_status_funil;

  -- Tarefas: inativos sem pendente
  with ins as (
    insert into public.crm_followup_tasks (clinic_id, cliente_id, titulo, due_date)
    select
      c.clinic_id,
      c.id,
      'Follow-up: paciente inativo',
      current_date + 7
    from public.cs_clientes c
    where c.clinic_id = p_clinic_id
      and c.status_funil = 'inativo'::public.crm_status_funil
      and not exists (
        select 1
        from public.crm_followup_tasks t
        where t.clinic_id = c.clinic_id
          and t.cliente_id = c.id
          and t.concluido_em is null
      )
    returning 1
  )
  select count(*)::integer into v_tasks from ins;

  -- Candidatos WhatsApp: sumido, sem contacto há 7+ dias
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'cliente_id', p.id,
        'nome', p.nome,
        'telefone', p.telefone,
        'instance_name', v_inst,
        'mensagem',
          coalesce(
            nullif(trim(v_msg), ''),
            'Olá! Faz tempo que não nos visita. Quer agendar um horário connosco?'
          )
      )
    ),
    '[]'::jsonb
  )
  into v_candidates
  from public.cs_clientes p
  where p.clinic_id = p_clinic_id
    and p.status_funil = 'sumido'::public.crm_status_funil
    and (
      p.data_ultimo_contato is null
      or p.data_ultimo_contato < (now() - interval '7 days')
    )
    and p.telefone is not null
    and length(trim(p.telefone)) > 0
    and v_inst is not null
    and length(trim(v_inst)) > 0;

  return jsonb_build_object(
    'ok', true,
    'clinic_id', p_clinic_id,
    'tasks_created', v_tasks,
    'whatsapp_candidates', coalesce(v_candidates, '[]'::jsonb)
  );
end;
$$;

comment on function public.n8n_crm_daily_clinic_run(uuid) is
  'n8n: por clínica — inativo 60d, sumido 90d, tarefas inativos, lista reengajamento WhatsApp.';

revoke all on function public.n8n_crm_daily_clinic_run(uuid) from public;
grant execute on function public.n8n_crm_daily_clinic_run(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. n8n_cs_agendar: CRM após agendamento confirmado
-- ---------------------------------------------------------------------------
create or replace function public.n8n_cs_agendar(
  p_nome_cliente  text,
  p_telefone      text,
  p_profissional_id uuid,
  p_servico_id    uuid,
  p_data          date,
  p_horario       time,
  p_observacoes   text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_ag_id      uuid;
  v_updated    int;
  v_nome_prof  text;
  v_nome_serv  text;
  v_nome_cli   text;
  v_clinic_id  uuid;
begin
  v_nome_cli := trim(p_nome_cliente);

  select p.nome, p.clinic_id
  into   v_nome_prof, v_clinic_id
  from   public.cs_profissionais p
  where  p.id = p_profissional_id;

  select s.nome into v_nome_serv
  from   public.cs_servicos s
  where  s.id = p_servico_id;

  if v_nome_prof is null then
    raise exception 'profissional_id inválido: %', p_profissional_id;
  end if;
  if v_clinic_id is null then
    raise exception 'profissional sem clinic_id — associe-o a uma clínica antes de agendar';
  end if;
  if v_nome_serv is null then
    raise exception 'servico_id inválido: %', p_servico_id;
  end if;

  update public.cs_horarios_disponiveis
  set disponivel = false
  where profissional_id = p_profissional_id
    and data    = p_data
    and horario = p_horario
    and disponivel = true;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'horario_indisponivel',
      'message', 'Este horário não está disponível. Consulte as vagas antes de agendar.'
    );
  end if;

  insert into public.cs_clientes(nome, telefone, clinic_id)
  values (v_nome_cli, p_telefone, v_clinic_id)
  on conflict (clinic_id, telefone) where clinic_id is not null
  do update set nome = excluded.nome, updated_at = now()
  returning id into v_cliente_id;

  insert into public.cs_agendamentos(
    cliente_id, profissional_id, servico_id,
    data_agendamento, horario, status, observacoes,
    nome_cliente, nome_profissional, nome_procedimento,
    clinic_id
  )
  values (
    v_cliente_id, p_profissional_id, p_servico_id,
    p_data, p_horario, 'confirmado', coalesce(nullif(trim(p_observacoes), ''), ''),
    v_nome_cli, v_nome_prof, v_nome_serv,
    v_clinic_id
  )
  returning id into v_ag_id;

  if public.crm_clinic_has_access(v_clinic_id) then
    update public.cs_clientes c
    set
      status_funil = 'agendado'::public.crm_status_funil,
      data_ultimo_contato = now()
    where c.id = v_cliente_id
      and c.clinic_id = v_clinic_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'agendamento_id', v_ag_id,
    'cliente_id', v_cliente_id
  );
end;
$$;

revoke all on function public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) from public;
grant execute on function public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) to authenticated;
grant execute on function public.n8n_cs_agendar(text, text, uuid, uuid, date, time, text) to service_role;
