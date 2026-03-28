-- Painel web: expor agendamentos gravados pelo n8n em cs_agendamentos (modelo paralelo a public.appointments).
-- Executar no SQL Editor do Supabase após existir cs_agendamentos.
--
-- Inclui: listagem JSON + confirmação/cancelamento pelo dono (clinic owner via rls_is_clinic_owner).

alter table public.cs_agendamentos
  add column if not exists painel_confirmado boolean not null default false;

create or replace function public.painel_list_cs_agendamentos (p_clinic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tz text;
begin
  if not public.rls_is_clinic_owner (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select c.timezone into tz from public.clinics c where c.id = p_clinic_id;
  tz := coalesce(nullif(trim(tz), ''), 'America/Sao_Paulo');

  return coalesce(
    (
      select jsonb_agg(obj order by sort_ts)
      from (
        select
          jsonb_build_object(
            'id', 'cs:' || a.id::text,
            'starts_at', to_jsonb (
              ((a.data_agendamento + a.horario)::timestamp at time zone tz)
            ),
            'ends_at', to_jsonb (
              ((a.data_agendamento + a.horario)::timestamp at time zone tz)
              + make_interval(mins => coalesce(s.duracao_minutos, 60))
            ),
            'service_name',
              nullif(
                trim(
                  coalesce(a.nome_procedimento, s.nome)
                ),
                ''
              ),
            'status',
              case a.status
                when 'cancelado' then 'cancelled'
                when 'concluido' then 'completed'
                else 'scheduled'
              end,
            'source', case
              when coalesce(a.painel_confirmado, false) then 'painel'
              else 'whatsapp'
            end,
            'notes', nullif(trim(a.observacoes), ''),
            'patients', jsonb_build_object(
              'name', nullif(trim(coalesce(a.nome_cliente, c.nome)), ''),
              'phone', c.telefone
            ),
            'professionals', jsonb_build_object(
              'name', coalesce(nullif(trim(a.nome_profissional), ''), p.nome),
              'specialty', p.especialidade
            )
          ) as obj,
          ((a.data_agendamento + a.horario)::timestamp at time zone tz) as sort_ts
        from public.cs_agendamentos a
        inner join public.cs_clientes c on c.id = a.cliente_id
        inner join public.cs_profissionais p on p.id = a.profissional_id
        left join public.cs_servicos s on s.id = a.servico_id
      ) sub
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.painel_confirm_cs_agendamento (
  p_clinic_id uuid,
  p_cs_agendamento_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if not public.rls_is_clinic_owner (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.cs_agendamentos
  set painel_confirmado = true
  where id = p_cs_agendamento_id
    and status not in ('cancelado', 'concluido');

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_final');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.painel_cancel_cs_agendamento (
  p_clinic_id uuid,
  p_cs_agendamento_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_slot uuid;
begin
  if not public.rls_is_clinic_owner (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, profissional_id, data_agendamento, horario, status
  into v
  from public.cs_agendamentos
  where id = p_cs_agendamento_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v.status = 'cancelado' then
    return jsonb_build_object('ok', false, 'error', 'already_cancelled');
  end if;

  select h.id into v_slot
  from public.cs_horarios_disponiveis h
  where h.profissional_id = v.profissional_id
    and h.data = v.data_agendamento
    and h.horario = v.horario
  for update;

  if found then
    update public.cs_horarios_disponiveis
    set disponivel = true
    where id = v_slot;
  end if;

  update public.cs_agendamentos
  set
    status = 'cancelado',
    motivo_cancelamento = coalesce(motivo_cancelamento, 'Cancelado pelo painel'),
    atualizado_em = now()
  where id = v.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.painel_list_cs_agendamentos (uuid) from public;
grant execute on function public.painel_list_cs_agendamentos (uuid) to authenticated;
grant execute on function public.painel_list_cs_agendamentos (uuid) to service_role;

revoke all on function public.painel_confirm_cs_agendamento (uuid, uuid) from public;
grant execute on function public.painel_confirm_cs_agendamento (uuid, uuid) to authenticated;
grant execute on function public.painel_confirm_cs_agendamento (uuid, uuid) to service_role;

revoke all on function public.painel_cancel_cs_agendamento (uuid, uuid) from public;
grant execute on function public.painel_cancel_cs_agendamento (uuid, uuid) to authenticated;
grant execute on function public.painel_cancel_cs_agendamento (uuid, uuid) to service_role;
