-- PostgREST / RPC: com duas sobrecargas (uuid,uuid,bool) e (uuid,uuid,bool,bool com DEFAULT),
-- chamadas só com 3 argumentos tornam-se ambíguas.
-- Mantém-se apenas a versão de 4 parâmetros (último opcional com DEFAULT NULL).

DROP FUNCTION IF EXISTS public.painel_cs_set_slot_disponivel (uuid, uuid, boolean);

REVOKE ALL ON FUNCTION public.painel_cs_set_slot_disponivel (uuid, uuid, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.painel_cs_set_slot_disponivel (uuid, uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.painel_cs_set_slot_disponivel (uuid, uuid, boolean, boolean) TO service_role;
