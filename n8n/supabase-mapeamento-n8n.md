# Mapeamento Supabase ↔ n8n (tabelas do consultório)

Baseado em `supabase/schema.sql`. Tabelas: `clinics`, `patients`, `professionals`, `appointments`.

**Autenticação REST:** use a **service_role** no header `apikey` (só no n8n). A **anon** falha com RLS nas escritas.

**Base URL:** `https://<PROJECT_REF>.supabase.co/rest/v1/`

**Headers comuns:**

- `apikey: <SERVICE_ROLE_OU_ANON>`
- `Authorization: Bearer <MESMO_TOKEN>`
- `Content-Type: application/json`
- `Prefer: return=representation` (para o POST devolver a linha criada)

---

## 1. `patients` — antes de criar agendamento

| Coluna      | Tipo        | Obrigatório | Notas                          |
|------------|-------------|-------------|--------------------------------|
| `clinic_id`| uuid        | sim         | Fixo por consultório / webhook |
| `phone`    | text        | sim         | Ex.: `+5511999990000`          |
| `name`     | text        | não         |                                |
| `email`    | text        | não         |                                |

**Upsert (recomendado):** evita duplicar paciente na mesma clínica.

- Método: `POST`
- URL: `/rest/v1/patients`
- Header extra: `Prefer: resolution=merge-duplicates`
- Query: `?on_conflict=clinic_id,phone`
- Body:

```json
{
  "clinic_id": "UUID-DA-CLINICA",
  "phone": "+5511999990000",
  "name": "Nome do Paciente"
}
```

Resposta: usa o `id` devolvido como `patient_id` no agendamento.

---

## 2. `professionals` — resolver “com qual profissional”

| Coluna       | Tipo    | Notas                    |
|-------------|---------|--------------------------|
| `id`        | uuid    | vai para `professional_id` |
| `clinic_id` | uuid    | filtrar pela mesma clínica |
| `name`      | text    | match com texto da IA    |
| `is_active` | boolean | preferir `true`          |

**GET (lista para a IA ou para um nó Code fazer match):**

`GET /rest/v1/professionals?clinic_id=eq.<UUID>&is_active=eq.true&select=id,name,specialty`

---

## 3. `appointments` — colunas

| Coluna             | Tipo           | Obrigatório | Default / notas                                      |
|-------------------|----------------|-------------|------------------------------------------------------|
| `id`              | uuid           | não no POST | gerado automaticamente                               |
| `clinic_id`       | uuid           | **sim**     |                                                      |
| `professional_id` | uuid           | **sim**     | mesmo `clinic_id` (trigger valida)                 |
| `patient_id`      | uuid           | **sim**     | vem do upsert em `patients`                          |
| `starts_at`       | timestamptz    | **sim**     | ISO 8601 com fuso, ex. `2025-03-26T14:00:00-03:00`   |
| `ends_at`         | timestamptz    | **sim**     | **deve ser > `starts_at`**                           |
| `service_name`    | text           | não         | ex. `Consulta`, `Limpeza`                            |
| `status`          | enum           | não         | `scheduled` \| `cancelled` \| `completed` (default `scheduled`) |
| `source`          | text           | não         | ex. `whatsapp`, `n8n`                                |
| `notes`           | text           | não         |                                                      |
| `created_at` / `updated_at` | timestamptz | não | preenchidos pelo DB                                    |

**Regras importantes:**

- Dois `scheduled` **não podem sobrepor** no mesmo `professional_id` (constraint `appointments_no_overlap`). Se der erro, o horário choca com outro agendamento.

---

## 4. Agendar — `POST /rest/v1/appointments`

Body mínimo:

```json
{
  "clinic_id": "UUID-CLINIC",
  "professional_id": "UUID-PRO",
  "patient_id": "UUID-PATIENT",
  "starts_at": "2025-03-26T14:00:00-03:00",
  "ends_at": "2025-03-26T14:30:00-03:00",
  "service_name": "Consulta",
  "status": "scheduled",
  "source": "whatsapp"
}
```

Guarda o `id` da resposta para cancelar/remarcar por ID (melhor) ou usa o fluxo abaixo por telefone.

---

## 5. Cancelar — `PATCH` com filtro

Atualizar estado (não apagar a linha):

**Opção A — já tens o `id` do agendamento (da IA ou memória):**

`PATCH /rest/v1/appointments?id=eq.<UUID-DO-AGENDAMENTO>`

```json
{
  "status": "cancelled"
}
```

**Opção B — sem `id`, só telefone (precisas do próximo `scheduled`):**

O PostgREST não faz JOIN em PATCH direto; opções:

1. **Nó Postgres no n8n** (recomendado):

```sql
UPDATE public.appointments a
SET status = 'cancelled'
FROM public.patients p
WHERE a.patient_id = p.id
  AND p.clinic_id = $1::uuid
  AND p.phone = $2
  AND a.status = 'scheduled'
  AND a.starts_at > now()
ORDER BY a.starts_at
LIMIT 1;
```

(PostgreSQL não permite `ORDER BY`/`LIMIT` em `UPDATE` assim; usar subquery `WHERE id = (SELECT ...)` .)

Exemplo correto:

```sql
UPDATE public.appointments AS a
SET status = 'cancelled'
WHERE a.id = (
  SELECT a2.id
  FROM public.appointments a2
  INNER JOIN public.patients p ON p.id = a2.patient_id
  WHERE p.clinic_id = 'UUID-CLINIC'::uuid
    AND p.phone = '+5511999990000'
    AND a2.status = 'scheduled'
  ORDER BY a2.starts_at ASC
  LIMIT 1
);
```

2. Ou **GET** primeiro:  
   `GET /rest/v1/appointments?select=id,starts_at,patient_id,patients!inner(phone,clinic_id)&patients.phone=eq.+5511...&clinic_id=eq.<UUID>&status=eq.scheduled&order=starts_at.asc&limit=1`  
   depois **PATCH** com `id=eq.<id>`.

(A sintaxe exata do embed `patients!inner` depende da FK; se falhar, usa o nó **Postgres**.)

---

## 6. Remarcar — `PATCH`

Com `id` do agendamento:

`PATCH /rest/v1/appointments?id=eq.<UUID>`

```json
{
  "starts_at": "2025-03-27T10:00:00-03:00",
  "ends_at": "2025-03-27T10:30:00-03:00"
}
```

Se mudares também de profissional, inclui `professional_id` (tem de ser da mesma `clinic_id`). O overlap volta a ser validado para `scheduled`.

---

## 7. JSON sugerido para a IA (contrato)

Para o nó Code / Switch ler sempre a mesma forma:

```json
{
  "intent": "agendar | cancelar | remarcar | duvida",
  "clinic_id": "uuid ou null se fixo no workflow",
  "phone": "+5511999990000",
  "patient_name": "string",
  "professional_name": "string",
  "service_name": "string",
  "starts_at": "ISO8601",
  "ends_at": "ISO8601",
  "appointment_id": "uuid se o utilizador já souber",
  "notes": "opcional"
}
```

- **Agendar:** preencher phone, datas, professional_name (ou id), service_name.  
- **Cancelar:** phone (+ clinic); ou `appointment_id`.  
- **Remarcar:** `appointment_id` ou phone + novas datas.

---

## 8. Checklist rápido no n8n

| Passo | Ação |
|--------|------|
| 1 | `clinic_id` fixo no workflow ou vindo do webhook (slug → lookup `clinics`). |
| 2 | Upsert `patients` → `patient_id`. |
| 3 | Match `professionals` → `professional_id`. |
| 4 | `POST appointments` com `starts_at` / `ends_at` válidos. |
| 5 | Cancelar: `PATCH` `status=cancelled`. |
| 6 | Remarcar: `PATCH` novos horários (e overlap OK). |

---

## 9. `leads_pagamento`

Tabela à parte do fluxo de agenda; só integra se quiseres ligar pagamentos ou CRM ao mesmo webhook.
