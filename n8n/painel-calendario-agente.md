# n8n (agente + ferramentas) → painel Next.js (calendário)

O painel em **Next.js** lê a tabela **`public.appointments`** (com `patients` e `professionals` em join). Tudo o que o fluxo gravar aí **aparece no calendário e na lista** após **Atualizar** (ou ao recarregar a página).

## O que alinhar no teu workflow

| Ferramenta do agente (exemplo) | Em Supabase | Notas |
|-------------------------------|-------------|--------|
| `criar_evento` | `INSERT` em `appointments` (+ upsert `patients`, `professional_id` válido) | Mesmos campos do `supabase-mapeamento-n8n.md` |
| `reagendar` | `UPDATE` `starts_at`, `ends_at` (e opcionalmente `professional_id`) | Respeitar overlap por profissional |
| `deletar_evento` | Preferir `UPDATE status = 'cancelled'` (mantém histórico no painel) | Ou apagar só se quiseres mesmo remover |
| `listar_eventos` | `SELECT` em `appointments` com filtros por data / profissional | Pode alimentar o contexto da IA |

## Leads vs agendamentos

- **`leads_pagamento`** (ou “lead existe”) é **paralelo** ao fluxo de marcação.
- O **calendário do dono** não usa leads: usa **`appointments`**.  
  Quando o lead **virar** marcação confirmada, o nó que hoje “cria evento” deve escrever em **`appointments`** (não só numa tabela de leads).

## Autenticação API

- No **n8n**, chamadas REST ao Supabase com **`service_role`** (só no servidor) evitam bloqueios de RLS.
- O **portal** usa **anon + login** + RLS (`owner_id` na `clinics`).

## Resumo

Um único “contrato”: **fonte de verdade dos compromissos na clínica = `appointments`**.  
O agente, o webhook simples e o WhatsApp devem convergir para esta tabela para o painel tipo calendário refletir tudo.
