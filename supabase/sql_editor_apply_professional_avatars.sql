-- =============================================================================
-- Corrige: "column professionals.avatar_path does not exist"
--
-- No Supabase: Dashboard → SQL Editor → New query → colar este ficheiro → Run
-- Idempotente: pode voltar a correr sem problema.
-- Alternativa (CLI, na pasta do projeto): npx supabase db push
-- =============================================================================

alter table public.professionals
  add column if not exists avatar_path text,
  add column if not exists avatar_emoji text;

comment on column public.professionals.avatar_path is
  'Caminho no bucket professional-avatars: {clinic_id}/{professional_id}.ext';
comment on column public.professionals.avatar_emoji is
  'Emoji exibido quando não há foto (opcional).';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'professional-avatars',
  'professional-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "professional_avatars_public_read" on storage.objects;
create policy "professional_avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'professional-avatars');

drop policy if exists "professional_avatars_owner_insert" on storage.objects;
create policy "professional_avatars_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  );

drop policy if exists "professional_avatars_owner_update" on storage.objects;
create policy "professional_avatars_owner_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  )
  with check (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  );

drop policy if exists "professional_avatars_owner_delete" on storage.objects;
create policy "professional_avatars_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'professional-avatars'
    and public.rls_has_clinic_access((split_part(name, '/', 1))::uuid)
  );

-- Só necessário se usar agendamentos cs_agendamentos no painel (RPC).
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

revoke all on function public.painel_list_cs_agendamentos (uuid) from public;
grant execute on function public.painel_list_cs_agendamentos (uuid) to authenticated;
grant execute on function public.painel_list_cs_agendamentos (uuid) to service_role;
