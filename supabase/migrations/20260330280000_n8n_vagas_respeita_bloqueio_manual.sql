-- n8n: listar e reservar só vagas livres (não bloqueadas manualmente no painel).
-- Igual a supabase/n8n_cs_agendar_respeita_disponivel.sql

create or replace function public.n8n_cs_consultar_vagas ()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(j.slot order by j.sdata, j.shour),
    '[]'::jsonb
  )
  from (
    select
      jsonb_build_object(
        'horario_id', h.id,
        'data', to_char(h.data, 'DD/MM/YYYY'),
        'dia_semana', trim(to_char(h.data, 'Day')),
        'horario', to_char(h.horario, 'HH24:MI'),
        'profissional_id', p.id,
        'profissional', p.nome,
        'especialidade', p.especialidade,
        'disponivel', true
      ) as slot,
      h.data as sdata,
      h.horario as shour
    from cs_horarios_disponiveis h
    inner join cs_profissionais p on p.id = h.profissional_id
    left join clinics cl on cl.id = p.clinic_id
    where h.disponivel = true
      and coalesce(h.bloqueio_manual, false) = false
      and p.ativo = true
      and h.data >= current_date
      and h.data <= current_date + interval '30 days'
      and (
        cl.id is null
        or extract(hour from h.horario)::integer = any (
          coalesce(
            cl.agenda_visible_hours,
            array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[]
          )
        )
      )
    order by h.data asc, h.horario asc
    limit 20
  ) j;
$$;

create or replace function public.n8n_cs_agendar (
  p_nome_cliente text,
  p_telefone text,
  p_profissional_id uuid,
  p_servico_id uuid,
  p_data date,
  p_horario time,
  p_observacoes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_ag_id uuid;
  v_updated int;
  v_nome_prof text;
  v_nome_serv text;
  v_nome_cli text;
  v_allowed boolean;
begin
  v_nome_cli := trim(p_nome_cliente);

  select p.nome into v_nome_prof
  from cs_profissionais p
  where p.id = p_profissional_id;

  select s.nome into v_nome_serv
  from cs_servicos s
  where s.id = p_servico_id;

  if v_nome_prof is null then
    raise exception 'profissional_id inválido: %', p_profissional_id;
  end if;
  if v_nome_serv is null then
    raise exception 'servico_id inválido: %', p_servico_id;
  end if;

  select
    (
      cl.id is null
      or extract(hour from p_horario)::integer = any (
        coalesce(
          cl.agenda_visible_hours,
          array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[]
        )
      )
    )
  into v_allowed
  from cs_profissionais p
  left join clinics cl on cl.id = p.clinic_id
  where p.id = p_profissional_id;

  if coalesce(v_allowed, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'error', 'hora_fora_da_agenda_clinica',
      'message',
      'Este horário não está habilitado na configuração global da clínica.'
    );
  end if;

  update cs_horarios_disponiveis
  set
    disponivel = false,
    bloqueio_manual = false
  where profissional_id = p_profissional_id
    and data = p_data
    and horario = p_horario
    and disponivel = true
    and coalesce(bloqueio_manual, false) = false;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'horario_indisponivel',
      'message', 'Este horário não está disponível (ocupado ou inexistente na agenda). Use novamente a consulta de vagas.'
    );
  end if;

  insert into cs_clientes (nome, telefone)
  values (v_nome_cli, p_telefone)
  on conflict (telefone) do update
    set nome = excluded.nome,
        updated_at = now()
  returning id into v_cliente_id;

  insert into cs_agendamentos (
    cliente_id,
    profissional_id,
    servico_id,
    data_agendamento,
    horario,
    status,
    observacoes,
    nome_cliente,
    nome_profissional,
    nome_procedimento
  )
  values (
    v_cliente_id,
    p_profissional_id,
    p_servico_id,
    p_data,
    p_horario,
    'confirmado',
    coalesce(nullif(trim(p_observacoes), ''), ''),
    v_nome_cli,
    v_nome_prof,
    v_nome_serv
  )
  returning id into v_ag_id;

  return jsonb_build_object(
    'ok', true,
    'agendamento_id', v_ag_id,
    'cliente_id', v_cliente_id
  );
end;
$$;

create or replace function public.n8n_cs_reagendar (
  p_agendamento_id uuid,
  p_nova_data date,
  p_novo_horario time,
  p_novo_profissional_id uuid,
  p_profissional_antigo_id uuid,
  p_data_antiga date,
  p_horario_antigo time
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome_prof text;
  v_same_slot boolean;
  v_booked int;
begin
  select p.nome into v_nome_prof
  from cs_profissionais p
  where p.id = p_novo_profissional_id;

  if v_nome_prof is null then
    raise exception 'p_novo_profissional_id inválido: %', p_novo_profissional_id;
  end if;

  v_same_slot :=
    p_novo_profissional_id = p_profissional_antigo_id
    and p_nova_data = p_data_antiga
    and p_novo_horario = p_horario_antigo;

  if v_same_slot then
    update cs_agendamentos
    set
      atualizado_em = now()
    where id = p_agendamento_id;

    return jsonb_build_object('ok', true, 'agendamento_id', p_agendamento_id);
  end if;

  update cs_horarios_disponiveis
  set
    disponivel = false,
    bloqueio_manual = false
  where profissional_id = p_novo_profissional_id
    and data = p_nova_data
    and horario = p_novo_horario
    and disponivel = true
    and coalesce(bloqueio_manual, false) = false;

  get diagnostics v_booked = row_count;
  if v_booked = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'horario_indisponivel',
      'message', 'O novo horário não está disponível. Consulte as vagas antes de reagendar.'
    );
  end if;

  update cs_horarios_disponiveis
  set
    disponivel = true,
    bloqueio_manual = false
  where profissional_id = p_profissional_antigo_id
    and data = p_data_antiga
    and horario = p_horario_antigo;

  update cs_agendamentos
  set
    data_agendamento = p_nova_data,
    horario = p_novo_horario,
    profissional_id = p_novo_profissional_id,
    nome_profissional = v_nome_prof,
    status = 'reagendado',
    atualizado_em = now()
  where id = p_agendamento_id;

  return jsonb_build_object('ok', true, 'agendamento_id', p_agendamento_id);
end;
$$;
