"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { friendlyAuthError } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";
import { AdminAuthVisualShell } from "./admin-auth-visual-shell";
import { IconGoogle, IconLock, IconMail } from "./auth-icons";

const pillWrap =
  "relative flex items-center rounded-full border border-neutral-600 bg-neutral-950/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)] transition focus-within:border-amber-500/50 focus-within:ring-2 focus-within:ring-amber-500/25";

const btnPrimary =
  "w-full rounded-full bg-amber-500 py-3.5 text-sm font-semibold text-neutral-950 shadow-md transition hover:bg-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:opacity-50";

const btnGoogle =
  "flex w-full items-center justify-center gap-2 rounded-full border border-neutral-600 bg-neutral-900 py-3.5 text-sm font-semibold text-neutral-100 shadow-sm transition hover:bg-neutral-800 disabled:opacity-50";

/** Cadastro só de utilizador Supabase — sem clínica nem profissionais (system admin / equipa plataforma). */
export function AdminRegisterForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const errId = useId();
  const noticeId = useId();

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user?.email) setEmail(s.user.email);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user?.email) setEmail(s.user.email);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  async function signInWithGoogle() {
    if (!supabase) return;
    setError(null);
    setBusy(true);
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const { error: oErr } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/login/admin")}`,
        queryParams: { prompt: "select_account" },
      },
    });
    setBusy(false);
    if (oErr) setError(friendlyAuthError(oErr.message));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    setNotice(null);

    const mail = email.trim();
    if (!mail) {
      setError("Indique o email.");
      return;
    }
    if (!password || password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setBusy(true);
    const origin =
      typeof window !== "undefined" ? window.location.origin : undefined;
    const { data, error: signErr } = await supabase.auth.signUp({
      email: mail,
      password,
      options: origin
        ? { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/login/admin")}` }
        : undefined,
    });
    if (signErr) {
      setError(friendlyAuthError(signErr.message));
      setBusy(false);
      return;
    }
    if (!data.user) {
      setError(
        "Não foi possível criar a conta. O email pode já estar em uso — tente entrar no login de admin."
      );
      setBusy(false);
      return;
    }

    if (data.session) {
      setNotice(
        "Conta criada. Inclua este email em SYSTEM_ADMIN_EMAILS no servidor, reinicie a app e entre em Login de admin."
      );
      router.push("/login/admin");
      router.refresh();
    } else {
      setNotice(
        "Confirme o email (link enviado). Depois inclua o email em SYSTEM_ADMIN_EMAILS e use o login de admin."
      );
    }
    setBusy(false);
  }

  if (!supabase) {
    return (
      <AdminAuthVisualShell>
        <p className="text-center text-sm text-red-400">
          Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY em .env.local.
        </p>
      </AdminAuthVisualShell>
    );
  }

  if (!authReady) {
    return (
      <AdminAuthVisualShell>
        <p className="text-center text-sm text-neutral-500">A carregar…</p>
      </AdminAuthVisualShell>
    );
  }

  if (session?.user) {
    return (
      <AdminAuthVisualShell>
        <h1 className="text-center font-display text-2xl font-semibold tracking-tight text-white">
          Já tem sessão
        </h1>
        <p className="mt-2 text-center text-sm text-neutral-400">
          Para aceder ao painel admin, o email da conta tem de estar em SYSTEM_ADMIN_EMAILS (ou IDs /
          metadata configurados no servidor).
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href="/login/admin"
            className="block w-full rounded-full bg-amber-500 py-3.5 text-center text-sm font-semibold text-neutral-950 hover:bg-amber-400"
          >
            Ir para login de admin
          </Link>
          <Link
            href="/cadastro"
            className="block w-full rounded-full border border-neutral-600 py-3.5 text-center text-sm font-medium text-neutral-300 hover:bg-neutral-800"
          >
            Cadastro de clínica (cliente)
          </Link>
          <button
            type="button"
            onClick={() => void supabase.auth.signOut().then(() => router.refresh())}
            className="text-center text-sm text-amber-400/90 underline-offset-2 hover:underline"
          >
            Terminar sessão
          </button>
        </div>
      </AdminAuthVisualShell>
    );
  }

  return (
    <AdminAuthVisualShell>
      <div className="mb-3 flex justify-center">
        <span className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-xs font-semibold tracking-wide text-amber-400">
          🛡 Criar conta — equipa da plataforma
        </span>
      </div>
      <h1 className="text-center font-display text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">
        Cadastro de administrador
      </h1>
      <p className="mt-2 text-center text-sm text-neutral-400">
        Não pedimos nome da clínica nem profissionais. Isto é só a conta Supabase. Depois, quem gere o
        servidor deve autorizar o email em SYSTEM_ADMIN_EMAILS.
      </p>
      <p className="mt-3 rounded-xl border border-amber-700/50 bg-amber-950/40 px-3 py-2.5 text-center text-xs leading-relaxed text-amber-100/90">
        <strong className="text-amber-400">Nota:</strong> donos de clínicas usam{" "}
        <Link href="/cadastro" className="font-semibold text-amber-300 underline-offset-2 hover:underline">
          Cadastro da clínica
        </Link>
        .
      </p>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center" aria-hidden>
          <span className="w-full border-t border-neutral-700" />
        </div>
        <p className="relative mx-auto w-fit bg-neutral-900 px-3 text-center text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          ou
        </p>
      </div>

      <button
        type="button"
        onClick={() => void signInWithGoogle()}
        disabled={busy}
        className={btnGoogle}
      >
        <IconGoogle className="h-5 w-5" />
        Continuar com Google
      </button>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center" aria-hidden>
          <span className="w-full border-t border-neutral-700" />
        </div>
        <p className="relative mx-auto w-fit bg-neutral-900 px-3 text-center text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          com email
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        aria-describedby={
          error ? errId : notice ? noticeId : undefined
        }
      >
        <div>
          <label
            htmlFor="admin-reg-email"
            className="mb-1.5 block text-xs font-medium text-neutral-400"
          >
            Email
          </label>
          <div className={pillWrap}>
            <span className="pointer-events-none absolute left-4 text-neutral-500">
              <IconMail className="h-5 w-5" />
            </span>
            <input
              id="admin-reg-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-full bg-transparent py-3.5 pl-12 pr-5 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
              placeholder="admin@…"
            />
          </div>
        </div>
        <div>
          <label
            htmlFor="admin-reg-password"
            className="mb-1.5 block text-xs font-medium text-neutral-400"
          >
            Senha
          </label>
          <div className={pillWrap}>
            <span className="pointer-events-none absolute left-4 text-neutral-500">
              <IconLock className="h-5 w-5" />
            </span>
            <input
              id="admin-reg-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-full bg-transparent py-3.5 pl-12 pr-5 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
              placeholder="Mínimo 6 caracteres"
            />
          </div>
        </div>

        {error ? (
          <p id={errId} className="text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p id={noticeId} className="text-sm text-emerald-400/90" role="status">
            {notice}
          </p>
        ) : null}

        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? "A criar…" : "Criar conta de admin"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-neutral-500">
        Já tem conta?{" "}
        <Link
          href="/login/admin"
          className="font-semibold text-amber-400 underline-offset-2 hover:underline"
        >
          Entrar como admin
        </Link>
      </p>
    </AdminAuthVisualShell>
  );
}
