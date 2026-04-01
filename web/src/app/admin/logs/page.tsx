import type { Metadata } from "next";
import { getSupabaseProjectRef } from "@/lib/supabase/project-ref";

export const metadata: Metadata = {
  title: "Logs",
};

function DashLink({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-2xl border border-neutral-700 bg-neutral-900/60 p-5 transition-colors hover:border-amber-500/40 hover:bg-neutral-900/90"
    >
      <h2 className="text-sm font-semibold text-amber-400">{title}</h2>
      <p className="mt-2 text-sm text-neutral-400">{body}</p>
      <p className="mt-3 break-all text-xs text-neutral-600">{href}</p>
    </a>
  );
}

export default function AdminLogsPage() {
  const ref = getSupabaseProjectRef();
  const base = ref ? `https://supabase.com/dashboard/project/${ref}` : null;

  return (
    <>
      <header className="mb-8">
        <h1 className="font-display text-2xl font-semibold text-white">Logs e auditoria</h1>
        <p className="mt-2 text-sm text-neutral-400">
          O sistema não grava ainda um audit log próprio na aplicação. Use os painéis oficiais para
          erros de API, Postgres e Auth.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {base ? (
          <>
            <DashLink
              href={`${base}/logs/explorer`}
              title="Supabase — Log Explorer"
              body="Consultar pedidos à API, erros recentes e filtros por serviço."
            />
            <DashLink
              href={`${base}/editor`}
              title="Supabase — SQL Editor"
              body="Consultas ad-hoc e diagnóstico (RLS, contagens, integridade)."
            />
            <DashLink
              href={`${base}/auth/users`}
              title="Supabase — Auth / Utilizadores"
              body="Lista de contas, provedores ligados e metadata."
            />
            <DashLink
              href={`${base}/database/replication`}
              title="Supabase — Base de dados"
              body="Esquema, migrações e estado das tabelas (atalho geral do projeto)."
            />
          </>
        ) : (
          <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100 lg:col-span-2">
            Defina <code className="rounded bg-neutral-900 px-1">NEXT_PUBLIC_SUPABASE_URL</code> para
            gerar links diretos ao projeto no dashboard Supabase.
          </div>
        )}

        <div className="rounded-2xl border border-dashed border-neutral-600 bg-neutral-900/30 p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-white">Futuro: audit log na app</h2>
          <p className="mt-2 text-sm text-neutral-400">
            Pode acrescentar uma tabela{" "}
            <code className="rounded bg-neutral-800 px-1 text-xs">platform_audit_log</code> e registar
            alterações feitas por system admins (planos, flags globais, etc.), consultável nesta
            página.
          </p>
        </div>
      </div>
    </>
  );
}
