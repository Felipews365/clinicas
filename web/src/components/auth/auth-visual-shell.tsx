import Link from "next/link";
import type { ReactNode } from "react";

/** Imagem de fundo suave (arquitetura / ambiente corporativo). Unsplash — uso conforme licença Unsplash. */
const HERO_BG =
  "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=70&w=2400";

type AuthVisualShellProps = {
  children: ReactNode;
};

export function AuthVisualShell({ children }: AuthVisualShellProps) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-200">
      <div
        className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url('${HERO_BG}')` }}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-0 bg-gradient-to-b from-white/75 via-white/60 to-white/80 backdrop-blur-[2px]"
        aria-hidden
      />

      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8 sm:py-6">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-slate-900 transition hover:opacity-80"
        >
          Consultório
        </Link>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0047AB] text-xs font-bold text-white shadow-sm"
          aria-hidden
        >
          C
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-4 pb-16 pt-4 sm:px-6">
        <div className="rounded-[1.75rem] bg-white p-7 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.25)] sm:p-9">
          {children}
        </div>
      </main>
    </div>
  );
}
