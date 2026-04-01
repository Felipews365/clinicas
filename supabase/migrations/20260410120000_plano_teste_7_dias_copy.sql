-- Texto do plano trial alinhado a 7 dias (app + landing).
update public.planos
set
  descricao = 'Trial de 7 dias para validar o painel e integrações.',
  features = array[
    '7 dias de teste com data de expiração',
    'Funções essenciais do painel',
    'Ideal para avaliar antes de contratar'
  ],
  updated_at = now()
where codigo = 'teste';
