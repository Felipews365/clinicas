-- Prontuário (Fase 2) — expande os tipos de registro para incluir documentos
-- clínicos (receita, declaração) além dos já existentes. Tenant-safe: não mexe
-- em clinic_id nem RLS; só amplia o CHECK do tipo.
alter table public.cs_prontuario_registros
  drop constraint if exists cs_prontuario_registros_tipo_check;

alter table public.cs_prontuario_registros
  add constraint cs_prontuario_registros_tipo_check
  check (tipo in ('anamnese', 'evolucao', 'atestado', 'nota', 'receita', 'declaracao'));
