-- Painel web: expor agendamentos gravados pelo n8n em cs_agendamentos (modelo paralelo a public.appointments).
-- Executar no SQL Editor do Supabase após existir cs_agendamentos.
--
-- Inclui: listagem JSON + confirmação/cancelamento (dono ou clinic_members via rls_has_clinic_access).
-- Espelho da migração 20260403120000_cs_tenant_isolation.sql (filtro tenant em cs_profissionais / cs_agendamentos).

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
  if not public.rls_has_clinic_access (p_clinic_id) then
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
              'id', pr_panel.id,
              'name', coalesce(nullif(trim(a.nome_profissional), ''), p.nome),
              'specialty', coalesce(pr_panel.specialty, p.especialidade),
              'panel_color', pr_panel.panel_color,
              'avatar_path', pr_panel.avatar_path,
              'avatar_emoji', pr_panel.avatar_emoji
            )
          ) as obj,
          ((a.data_agendamento + a.horario)::timestamp at time zone tz) as sort_ts
        from public.cs_agendamentos a
        inner join public.cs_clientes c on c.id = a.cliente_id
        inner join public.cs_profissionais p on p.id = a.profissional_id
        left join public.cs_servicos s on s.id = a.servico_id
        left join public.professionals pr_panel
          on pr_panel.clinic_id = p_clinic_id
          and (
            pr_panel.cs_profissional_id = p.id
            or pr_panel.id = p.id
          )
        where
          p.clinic_id = p_clinic_id
          and coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
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
  if not public.rls_has_clinic_access (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.cs_agendamentos a
  set
    painel_confirmado = true
  from
    public.cs_profissionais p
  where
    a.id = p_cs_agendamento_id
    and p.id = a.profissional_id
    and p.clinic_id = p_clinic_id
    and coalesce (a.clinic_id, p.clinic_id) = p_clinic_id
    and a.status not in ('cancelado', 'concluido');

  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_final');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Ver migration 20260429193000_painel_cancel_trigger_overlap_duracao.sql (overlap + mutacao_origem + meta WhatsApp).
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
  v_whatsapp text;
  v_prof_nome text;
  v_prof_genero text;
  v_cliente_tel text;
begin
  if not public.rls_has_clinic_access (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    a.id,
    a.cliente_id,
    a.profissional_id,
    a.data_agendamento,
    a.horario,
    a.status,
    coalesce(a.duracao_minutos, 60) as duracao_minutos,
    coalesce(nullif(trim(a.nome_cliente), ''), '') as nome_cliente,
    coalesce(nullif(trim(a.nome_procedimento), ''), '') as nome_procedimento
  into v
  from public.cs_agendamentos a
  inner join public.cs_profissionais p on p.id = a.profissional_id
  where
    a.id = p_cs_agendamento_id
    and p.clinic_id = p_clinic_id
    and coalesce(a.clinic_id, p.clinic_id) = p_clinic_id
  for update of a;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v.status = 'cancelado' then
    return jsonb_build_object('ok', false, 'error', 'already_cancelled');
  end if;

  update public.cs_horarios_disponiveis h
  set disponivel = true
  where h.profissional_id = v.profissional_id
    and h.data = v.data_agendamento
    and (h.data + h.horario) < (v.data_agendamento + v.horario) + (v.duracao_minutos || ' minutes')::interval
    and (h.data + h.horario) + interval '1 hour' > (v.data_agendamento + v.horario);

  update public.cs_agendamentos
  set
    status = 'cancelado',
    motivo_cancelamento = coalesce(motivo_cancelamento, 'Cancelado pelo painel'),
    atualizado_em = now(),
    mutacao_origem = 'painel'
  where id = v.id;

  select prof.name, prof.whatsapp, prof.gender
  into v_prof_nome, v_whatsapp, v_prof_genero
  from public.professionals prof
  where
    prof.cs_profissional_id = v.profissional_id
    and prof.clinic_id = p_clinic_id;

  if coalesce(trim(v_prof_nome), '') = '' then
    select p.nome, p.gender into v_prof_nome, v_prof_genero
    from public.cs_profissionais p
    where p.id = v.profissional_id;
  end if;

  select nullif(trim(c.telefone), '') into v_cliente_tel
  from public.cs_clientes c
  where c.id = v.cliente_id
    and c.clinic_id = p_clinic_id;

  return jsonb_build_object(
    'ok', true,
    'profissional_whatsapp', v_whatsapp,
    'profissional_nome', nullif(trim(v_prof_nome), ''),
    'profissional_genero', case
      when v_prof_genero in ('M', 'F') then v_prof_genero
      else null
    end,
    'nome_cliente', nullif(trim(v.nome_cliente), ''),
    'cliente_telefone', v_cliente_tel,
    'nome_procedimento', nullif(trim(v.nome_procedimento), ''),
    'data_agendamento', v.data_agendamento,
    'horario', to_char(v.horario, 'HH24:MI')
  );
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

-- Reagendar cs_agendamentos a partir do painel (delega em n8n_cs_reagendar).
-- Ver também migration 20260427120000_painel_reagendar_cs_agendamento.sql

create or replace function public.painel_reagendar_cs_agendamento (
  p_clinic_id uuid,
  p_cs_agendamento_id uuid,
  p_nova_data date,
  p_novo_cs_profissional_id uuid,
  p_novo_horario time
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_novo_prof uuid;
  v_res jsonb;
begin
  if not public.rls_has_clinic_access (p_clinic_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    a.id,
    a.profissional_id,
    a.data_agendamento,
    a.horario,
    a.status
  into v
  from public.cs_agendamentos a
  inner join public.cs_profissionais p on p.id = a.profissional_id
  where
    a.id = p_cs_agendamento_id
    and p.clinic_id = p_clinic_id
    and coalesce(a.clinic_id, p.clinic_id) = p_clinic_id
  for update of a;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v.status in ('cancelado', 'concluido') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  v_novo_prof := coalesce(p_novo_cs_profissional_id, v.profissional_id);

  if v_novo_prof is distinct from v.profissional_id then
    if not exists (
      select 1
      from public.cs_profissionais csp
      where csp.id = v_novo_prof
        and csp.clinic_id = p_clinic_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'profissional_invalido');
    end if;
  end if;

  v_res := public.n8n_cs_reagendar(
    p_cs_agendamento_id,
    p_nova_data,
    p_novo_horario,
    v_novo_prof,
    v.profissional_id,
    v.data_agendamento,
    v.horario
  );

  return v_res;
end;
$$;

revoke all on function public.painel_reagendar_cs_agendamento (uuid, uuid, date, uuid, time) from public;
grant execute on function public.painel_reagendar_cs_agendamento (uuid, uuid, date, uuid, time) to authenticated;
grant execute on function public.painel_reagendar_cs_agendamento (uuid, uuid, date, uuid, time) to service_role;
