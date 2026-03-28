alter table public.cs_agendamentos add column if not exists nome_cliente text;
alter table public.cs_agendamentos add column if not exists nome_profissional text;
alter table public.cs_agendamentos add column if not exists nome_procedimento text;

create or replace function public.n8n_cs_buscar_agendamentos (p_telefone text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', x.id,
        'data', x.data,
        'data_iso', x.data_iso,
        'horario', x.horario,
        'servico', x.servico,
        'profissional_id', x.profissional_id,
        'profissional', x.profissional,
        'especialidade', x.especialidade,
        'status', x.status,
        'observacoes', x.observacoes,
        'nome_cliente', x.nome_cliente,
        'nome_profissional', x.nome_profissional,
        'nome_procedimento', x.nome_procedimento
      )
      order by x.data_sort, x.horario_sort
    ),
    '[]'::jsonb
  )
  from (
    select
      a.id,
      to_char(a.data_agendamento, 'DD/MM/YYYY') as data,
      to_char(a.data_agendamento, 'YYYY-MM-DD') as data_iso,
      to_char(a.horario, 'HH24:MI') as horario,
      coalesce(nullif(trim(a.nome_procedimento), ''), s.nome) as servico,
      a.profissional_id,
      coalesce(nullif(trim(a.nome_profissional), ''), p.nome) as profissional,
      p.especialidade,
      a.status,
      a.observacoes,
      coalesce(nullif(trim(a.nome_cliente), ''), c.nome) as nome_cliente,
      coalesce(nullif(trim(a.nome_profissional), ''), p.nome) as nome_profissional,
      coalesce(nullif(trim(a.nome_procedimento), ''), s.nome) as nome_procedimento,
      a.data_agendamento as data_sort,
      a.horario as horario_sort
    from cs_agendamentos a
    inner join cs_clientes c on c.id = a.cliente_id
    inner join cs_servicos s on s.id = a.servico_id
    inner join cs_profissionais p on p.id = a.profissional_id
    where c.telefone = p_telefone
      and a.status not in ('cancelado', 'concluido')
      and a.data_agendamento >= current_date
  ) x;
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

  update cs_horarios_disponiveis
  set disponivel = false
  where profissional_id = p_profissional_id
    and data = p_data
    and horario = p_horario
    and disponivel = true;

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
  set disponivel = false
  where profissional_id = p_novo_profissional_id
    and data = p_nova_data
    and horario = p_novo_horario
    and disponivel = true;

  get diagnostics v_booked = row_count;
  if v_booked = 0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'horario_indisponivel',
      'message', 'O novo horário não está disponível. Consulte as vagas antes de reagendar.'
    );
  end if;

  update cs_horarios_disponiveis
  set disponivel = true
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

