# Consultório

Monorepo: app **Next.js** em [`web/`](web/), SQL **Supabase** em [`supabase/`](supabase/), workflows **n8n** em [`n8n/`](n8n/).

## GitHub

Repositório Git inicializado na raiz (branch `main`). O diretório `.cursor/` não é commitado (evita expor chaves MCP).

```bash
git commit -m "chore: initial commit"
```

Crie um repositório vazio no GitHub (sem README) e ligue o remoto:

```bash
git remote add origin https://github.com/SEU_USUARIO/consultorio.git
git push -u origin main
```

## Vercel

1. Em [vercel.com](https://vercel.com), **Add New → Project** e importe o repositório.
2. **Root Directory** (**obrigatório**): clique em **Edit** e escreva **`web`** — não deixe `./` nem vazio. A app Next.js e o `package.json` real estão dentro de `web/`.
3. O **Framework Preset** pode ficar em **Next.js** ou vazio (o `web/vercel.json` indica Next.js). **Não** definas **Install Command** tipo `npm install --prefix web` quando a raiz já é `web` — isso aponta para `web/web` e falha.
4. **Environment Variables** (produção — copie de `web/.env.local` ou use `web/.env.example` como guia):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_CLINIC_NAME` (opcional)
   - `AGENDAMENTOS_SYNC_SECRET` (opcional, se usar o webhook de sync)
5. Faça **Redeploy**. No **Supabase → Authentication → URL Configuration**, acrescente o URL de produção (ex. `https://seu-projeto.vercel.app/auth/callback`, `/login`, `/cadastro`, `/redefinir-senha`).

## Desenvolvimento local

```bash
npm install --prefix web
cd web && cp .env.example .env.local
# edite .env.local
npm run dev
```
