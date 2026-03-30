-- Cor de identificação no painel (paleta fixa guardada como hex).
alter table public.professionals
  add column if not exists panel_color text;

comment on column public.professionals.panel_color is
  'Hex da paleta do painel (ex.: #E7F7EE). Usado em cards e calendário.';

-- Lista cs_agendamentos inclui id / panel_color do profissional da clínica quando existir ligação.
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
              'id', pr_panel.id,
              'name', coalesce(nullif(trim(a.nome_profissional), ''), p.nome),
              'specialty', coalesce(pr_panel.specialty, p.especialidade),
              'panel_color', pr_panel.panel_color
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
      ) sub
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.painel_list_cs_agendamentos (uuid) from public;
grant execute on function public.painel_list_cs_agendamentos (uuid) to authenticated;
grant execute on function public.painel_list_cs_agendamentos (uuid) to service_role;
