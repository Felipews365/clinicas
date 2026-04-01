"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const nav = [
  { href: "/admin/dashboard", label: "Dashboard Admin", icon: IconLayout },
  { href: "/admin/clinicas", label: "Clínicas", icon: IconBuilding },
  { href: "/admin/planos", label: "Planos e Preços", icon: IconCredit },
  { href: "/admin/financeiro", label: "Financeiro", icon: IconWallet },
  { href: "/admin/metricas", label: "Métricas", icon: IconChart },
  { href: "/admin/logs", label: "Logs", icon: IconScroll },
] as const;

function IconLayout({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function IconBuilding({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
      <path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01" />
    </svg>
  );
}

function IconCredit({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

function IconWallet({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 12V7H5a2 2 0 010-4h14v4" />
      <path d="M3 5v14a2 2 0 002 2h16v-5" />
      <path d="M18 12a2 2 0 100 4 2 2 0 000-4z" />
    </svg>
  );
}

function IconChart({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="M7 12l4-4 4 4 6-6" />
    </svg>
  );
}

function IconScroll({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function IconMenu({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function IconClose({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function navLinkClass(active: boolean) {
  return [
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors",
    active
      ? "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40"
      : "text-neutral-300 hover:bg-white/5 hover:text-white",
  ].join(" ");
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const sidebarInner = (
    <>
      <div className="border-b border-neutral-800 px-4 py-4">
        <div className="inline-flex items-center gap-2 rounded-md bg-amber-500 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-950 shadow-sm">
          <span aria-hidden>⚙</span>
          SYSTEM ADMIN
        </div>
        <p className="mt-3 text-xs leading-snug text-neutral-500">
          Área restrita à equipa da plataforma.
        </p>
      </div>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-4" aria-label="Administração">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} className={navLinkClass(active)}>
              <Icon className="shrink-0 opacity-90" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-neutral-800 p-3">
        <Link
          href="/painel"
          className="block w-full rounded-lg border border-neutral-700 px-3 py-2 text-center text-xs font-medium text-neutral-400 transition-colors hover:border-amber-500/50 hover:text-amber-400"
        >
          Ir para o painel da clínica
        </Link>
      </div>
    </>
  );

  return (
    <div
      data-admin-root
      className="flex h-[100dvh] max-h-[100dvh] flex-col bg-[#111111] text-neutral-100 [--admin-bar-h:2.75rem]"
      style={{ colorScheme: "dark" }}
    >
      <div
        className="z-[60] flex min-h-[var(--admin-bar-h)] shrink-0 items-center gap-2 border-b border-amber-900/40 bg-[#92400e] px-3 py-2.5 text-sm text-amber-50 shadow-md sm:px-4"
        role="status"
      >
        <span className="shrink-0" aria-hidden>
          ⚠
        </span>
        <p className="min-w-0 leading-snug">
          Você está no painel de administração do sistema — alterações afetam todas as clínicas.
        </p>
      </div>

      <div className="flex min-h-0 flex-1">
        {mobileOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/60 sm:hidden"
            aria-label="Fechar menu"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        <aside
          id="admin-sidebar"
          className={[
            "fixed bottom-0 left-0 z-50 flex h-[calc(100dvh-var(--admin-bar-h))] w-[276px] shrink-0 flex-col border-r border-neutral-800 bg-[#0a0a0a] shadow-xl transition-transform duration-200 sm:static sm:z-auto sm:h-full sm:translate-x-0 sm:shadow-none",
            "top-[var(--admin-bar-h)] sm:top-auto",
            mobileOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0",
          ].join(" ")}
        >
          {sidebarInner}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col sm:border-l sm:border-neutral-800/80">
          <header className="flex items-center gap-2 border-b border-neutral-800 bg-[#141414] px-3 py-2 sm:hidden">
            <button
              type="button"
              className="rounded-lg p-2 text-amber-400 hover:bg-white/5"
              onClick={() => setMobileOpen((o) => !o)}
              aria-expanded={mobileOpen}
              aria-controls="admin-sidebar"
            >
              {mobileOpen ? <IconClose /> : <IconMenu />}
            </button>
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-500/90">
              Menu
            </span>
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 sm:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
