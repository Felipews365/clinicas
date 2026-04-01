import Link from "next/link";
import type { ReactNode } from "react";

type AdminAuthVisualShellProps = {
  children: ReactNode;
};

/** Shell visual do login de system admin — tema escuro e âmbar, distinto do painel da clínica. */
export function AdminAuthVisualShell({ children }: AdminAuthVisualShellProps) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#0a0a0a] text-neutral-100">
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(245,158,11,0.22),transparent_55%),radial-gradient(ellipse_80%_50%_at_100%_50%,rgba(180,83,9,0.12),transparent_45%),linear-gradient(180deg,#111_0%,#0a0a0a_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.07]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
        aria-hidden
      />

      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8 sm:py-6">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-neutral-100 transition hover:text-amber-400"
        >
          Consultório
        </Link>
        <div
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-400"
          aria-hidden
        >
          <span>⚙</span> Admin
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-4 pb-16 pt-4 sm:px-6">
        <div className="rounded-[1.75rem] border border-amber-500/20 bg-neutral-900/85 p-7 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.65)] backdrop-blur-sm sm:p-9">
          {children}
        </div>
      </main>
    </div>
  );
}
