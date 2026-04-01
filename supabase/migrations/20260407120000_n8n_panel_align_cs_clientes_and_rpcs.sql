-- Alinhamento fluxo n8n × painel: bot_ativo em cs_clientes + RPCs tenant-safe (overload).

-- ---------------------------------------------------------------------------
-- 1. cs_clientes.bot_ativo (substitui semântica de Clientes.botativo no n8n)
-- ---------------------------------------------------------------------------
alter table public.cs_clientes
  add column if not exists bot_ativo boolean not null default true;

comment on column public.cs_clientes.bot_ativo is
  'Quando false, o fluxo pode pausar atendimento automático para esse cliente (legado Clientes.botativo).';

-- ---------------------------------------------------------------------------
-- 2. n8n_cs_consultar_vagas(p_clinic_id) — só vagas do tenant
-- ---------------------------------------------------------------------------
create or replace function public.n8n_cs_consultar_vagas (p_clinic_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_clinic_id is null then '[]'::jsonb
    else coalesce(
      (
        select jsonb_agg(j.slot order by j.sdata, j.shour)
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
          from public.cs_horarios_disponiveis h
          inner join public.cs_profissionais p on p.id = h.profissional_id
          inner join public.clinics cl on cl.id = p_clinic_id
          where p.clinic_id = p_clinic_id
            and h.disponivel = true
            and coalesce(h.bloqueio_manual, false) = false
            and p.ativo = true
            and h.data >= current_date
            and h.data <= current_date + interval '30 days'
            and cl.id = p.clinic_id
            and extract(hour from h.horario)::integer = any (
              coalesce(
                cl.agenda_visible_hours,
                array[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]::integer[]
              )
            )
          order by h.data asc, h.horario asc
          limit 20
        ) j
      ),
      '[]'::jsonb
    )
  end;
$$;

revoke all on function public.n8n_cs_consultar_vagas (uuid) from public;
grant execute on function public.n8n_cs_consultar_vagas (uuid) to authenticated;
grant execute on function public.n8n_cs_consultar_vagas (uuid) to service_role;

comment on function public.n8n_cs_consultar_vagas (uuid) is
  'Lista até 20 vagas disponíveis apenas para a clínica indicada (multi-tenant).';

-- ---------------------------------------------------------------------------
-- 3. n8n_cs_buscar_agendamentos(p_telefone, p_clinic_id) — tenant-safe
-- ---------------------------------------------------------------------------
create or replace function public.n8n_cs_buscar_agendamentos (
  p_telefone text,
  p_clinic_id uuid
)
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
    from public.cs_agendamentos a
    inner join public.cs_clientes c on c.id = a.cliente_id
    inner join public.cs_servicos s on s.id = a.servico_id
    inner join public.cs_profissionais p on p.id = a.profissional_id
    where c.telefone = p_telefone
      and c.clinic_id = p_clinic_id
      and coalesce(a.clinic_id, p.clinic_id) = p_clinic_id
      and p.clinic_id = p_clinic_id
      and a.status not in ('cancelado', 'concluido')
      and a.data_agendamento >= current_date
  ) x;
$$;

revoke all on function public.n8n_cs_buscar_agendamentos (text, uuid) from public;
grant execute on function public.n8n_cs_buscar_agendamentos (text, uuid) to authenticated;
grant execute on function public.n8n_cs_buscar_agendamentos (text, uuid) to service_role;

comment on function public.n8n_cs_buscar_agendamentos (text, uuid) is
  'Agendamentos futuros do cliente por telefone, restritos à clínica (n8n multi-tenant).';
