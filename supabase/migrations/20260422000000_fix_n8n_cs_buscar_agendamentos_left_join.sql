-- Fix: n8n_cs_buscar_agendamentos agora usa LEFT JOIN em cs_servicos
-- Motivo: agendamentos criados pelo AI podem ter servico_id = NULL
-- (nome do procedimento fica em nome_procedimento como texto).
-- O INNER JOIN anterior retornava [] nesses casos, impedindo cancelamentos.

CREATE OR REPLACE FUNCTION public.n8n_cs_buscar_agendamentos(p_telefone text, p_clinic_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $$
BEGIN
  RETURN (
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
      coalesce(nullif(trim(a.nome_procedimento), ''), s.nome, '(sem serviço)') as servico,
      a.profissional_id,
      coalesce(nullif(trim(a.nome_profissional), ''), p.nome) as profissional,
      p.especialidade,
      a.status,
      a.observacoes,
      coalesce(nullif(trim(a.nome_cliente), ''), c.nome) as nome_cliente,
      coalesce(nullif(trim(a.nome_profissional), ''), p.nome) as nome_profissional,
      coalesce(nullif(trim(a.nome_procedimento), ''), s.nome, '(sem serviço)') as nome_procedimento,
      a.data_agendamento as data_sort,
      a.horario as horario_sort
    from public.cs_agendamentos a
    inner join public.cs_clientes     c on c.id = a.cliente_id
    left  join public.cs_servicos     s on s.id = a.servico_id   -- LEFT: servico_id pode ser NULL
    inner join public.cs_profissionais p on p.id = a.profissional_id
    where c.telefone = p_telefone
      and c.clinic_id = p_clinic_id
      and coalesce(a.clinic_id, p.clinic_id) = p_clinic_id
      and p.clinic_id = p_clinic_id
      and a.status not in ('cancelado', 'concluido')
      and a.data_agendamento >= current_date
  ) x
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.n8n_cs_buscar_agendamentos(p_telefone text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $$
BEGIN
  RETURN (
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
      coalesce(nullif(trim(a.nome_procedimento), ''), s.nome, '(sem serviço)') as servico,
      a.profissional_id,
      coalesce(nullif(trim(a.nome_profissional), ''), p.nome) as profissional,
      p.especialidade,
      a.status,
      a.observacoes,
      coalesce(nullif(trim(a.nome_cliente), ''), c.nome) as nome_cliente,
      coalesce(nullif(trim(a.nome_profissional), ''), p.nome) as nome_profissional,
      coalesce(nullif(trim(a.nome_procedimento), ''), s.nome, '(sem serviço)') as nome_procedimento,
      a.data_agendamento as data_sort,
      a.horario as horario_sort
    from public.cs_agendamentos a
    inner join public.cs_clientes     c on c.id = a.cliente_id
    left  join public.cs_servicos     s on s.id = a.servico_id   -- LEFT: servico_id pode ser NULL
    inner join public.cs_profissionais p on p.id = a.profissional_id
    where c.telefone = p_telefone
      and a.status not in ('cancelado', 'concluido')
      and a.data_agendamento >= current_date
  ) x
  );
END;
$$;
