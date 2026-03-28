-- Clínica Sorriso — modelo de agendamento + RPCs para n8n (toolHttpRequest → PostgREST)
-- Executar no SQL Editor do projeto Supabase (service role do n8n chama estas funções).

-- ======================== TABELAS ========================

create table if not exists public.cs_clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cs_servicos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  descricao text,
  duracao_minutos int not null default 60,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cs_profissionais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  especialidade text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cs_horarios_disponiveis (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.cs_profissionais (id) on delete cascade,
  data date not null,
  horario time not null,
  disponivel boolean not null default true,
  unique (profissional_id, data, horario)
);

create table if not exists public.cs_agendamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.cs_clientes (id) on delete restrict,
  profissional_id uuid not null references public.cs_profissionais (id) on delete restrict,
  servico_id uuid not null references public.cs_servicos (id) on delete restrict,
  data_agendamento date not null,
  horario time not null,
  status text not null default 'confirmado'
    check (status in ('confirmado', 'reagendado', 'cancelado', 'concluido')),
  observacoes text default '',
  motivo_cancelamento text,
  nome_cliente text,
  nome_profissional text,
  nome_procedimento text,
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_cs_agend_cliente on public.cs_agendamentos (cliente_id);
create index if not exists idx_cs_agend_data on public.cs_agendamentos (data_agendamento);
create index if not exists idx_cs_horarios_lookup
  on public.cs_horarios_disponiveis (profissional_id, data, horario);

-- ======================== RPCs (n8n) ========================

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
    where h.disponivel = true
      and p.ativo = true
      and h.data >= current_date
      and h.data <= current_date + interval '30 days'
    order by h.data asc, h.horario asc
    limit 20
  ) j;
$$;

create or replace function public.n8n_cs_consultar_servicos ()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(j.item order by j.nm),
    '[]'::jsonb
  )
  from (
    select
      jsonb_build_object(
        'servico_id', s.id,
        'nome', s.nome,
        'descricao', s.descricao,
        'duracao_minutos', s.duracao_minutos
      ) as item,
      s.nome as nm
    from cs_servicos s
    where s.ativo = true
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

create or replace function public.n8n_cs_cancelar (
  p_agendamento_id uuid,
  p_profissional_id uuid,
  p_data date,
  p_horario time,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update cs_agendamentos
  set
    status = 'cancelado',
    motivo_cancelamento = p_motivo,
    atualizado_em = now()
  where id = p_agendamento_id;

  update cs_horarios_disponiveis
  set disponivel = true
  where profissional_id = p_profissional_id
    and data = p_data
    and horario = p_horario;

  return jsonb_build_object('ok', true, 'agendamento_id', p_agendamento_id);
end;
$$;

-- Permissões PostgREST: JWT com anon ou service_role precisa de EXECUTE nas RPCs.
-- (Se só service_role tiver grant e a credencial do n8n for a chave anon, as tools falham.)
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'n8n_cs_%'
  loop
    execute format('revoke all on function %s from public', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
    execute format('grant execute on function %s to authenticated', r.fn);
    execute format('grant execute on function %s to anon', r.fn);
  end loop;
end $$;

-- ======================== SEED (opcional, para testar no n8n) ========================
-- insert into cs_profissionais (nome, especialidade) values ('Dra. Exemplo', 'Ortodontia');
-- insert into cs_servicos (nome, descricao, duracao_minutos) values ('Consulta', 'Avaliação', 30);
-- insert into cs_horarios_disponiveis (profissional_id, data, horario)
--   select id, current_date + 1, '09:00'::time from cs_profissionais limit 1;
