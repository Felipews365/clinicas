"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { friendlyAuthError } from "@/lib/auth-errors";
import { safeAdminPostLoginNext } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/client";
import { AdminAuthVisualShell } from "./admin-auth-visual-shell";
import { IconGoogle, IconLock, IconMail } from "./auth-icons";

const pillWrap =
  "relative flex items-center rounded-full border border-neutral-600 bg-neutral-950/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)] transition focus-within:border-amber-500/50 focus-within:ring-2 focus-within:ring-amber-500/25";

const btnPrimary =
  "w-full rounded-full bg-amber-500 py-3.5 text-sm font-semibold text-neutral-950 shadow-md transition hover:bg-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:opacity-50";

const btnGoogle =
  "flex w-full items-center justify-center gap-2 rounded-full border border-neutral-600 bg-neutral-900 py-3.5 text-sm font-semibold text-neutral-100 shadow-sm transition hover:bg-neutral-800 disabled:opacity-50";

export function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const afterLoginPath = useMemo(
    () => safeAdminPostLoginNext(searchParams.get("next")),
    [searchParams]
  );
  const supabase = useMemo(() => createClient(), []);
  const formErrorId = useId();
  const forgotErrId = useId();

  const [view, setView] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotNotice, setForgotNotice] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const urlError = searchParams.get("error");
  useEffect(() => {
    if (!urlError) return;
    setError(decodeURIComponent(urlError.replace(/\+/g, " ")));
    const q = new URLSearchParams(searchParams.toString());
    q.delete("error");
    const qs = q.toString();
    router.replace(qs ? `/login/admin?${qs}` : "/login/admin", { scroll: false });
  }, [urlError, router, searchParams]);

  async function signInWithGoogle() {
    if (!supabase) return;
    setError(null);
    setBusy(true);
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const nextQ = encodeURIComponent(afterLoginPath);
    const { error: oErr } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=${nextQ}`,
        queryParams: { prompt: "select_account" },
      },
    });
    setBusy(false);
    if (oErr) setError(friendlyAuthError(oErr.message));
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    const mail = email.trim();
    if (!mail || !password) {
      setError("Preencha email e senha.");
      return;
    }
    setBusy(true);
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: mail,
      password,
    });
    setBusy(false);
    if (signErr) {
      setError(friendlyAuthError(signErr.message));
      return;
    }
    router.push(afterLoginPath);
    router.refresh();
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setForgotError(null);
    setForgotNotice(null);
    const mail = forgotEmail.trim();
    if (!mail) {
      setForgotError("Indique o email da conta.");
      return;
    }
    setForgotBusy(true);
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const { error: rErr } = await supabase.auth.resetPasswordForEmail(mail, {
      redirectTo: `${origin}/auth/callback?next=/redefinir-senha`,
    });
    setForgotBusy(false);
    if (rErr) {
      setForgotError(friendlyAuthError(rErr.message));
      return;
    }
    setForgotNotice(
      "Se existir uma conta com este email, enviámos um link para redefinir a senha."
    );
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

  return (
    <AdminAuthVisualShell>
      {view === "forgot" ? (
        <>
          <h1 className="text-center font-display text-2xl font-semibold tracking-tight text-white">
            Recuperar senha
          </h1>
          <p className="mt-2 text-center text-sm text-neutral-400">
            Link de redefinição para o email da conta de administração.
          </p>
          <form
            className="mt-8 space-y-5"
            onSubmit={(e) => void handleForgot(e)}
            noValidate
          >
            <button
              type="button"
              className="text-sm font-medium text-amber-400 underline-offset-2 hover:underline"
              onClick={() => {
                setView("login");
                setForgotError(null);
                setForgotNotice(null);
              }}
            >
              ← Voltar ao login de admin
            </button>
            <div>
              <label
                htmlFor="admin-forgot-email"
                className="mb-1.5 block text-xs font-medium text-neutral-400"
              >
                Email
              </label>
              <div className={pillWrap}>
                <span className="pointer-events-none absolute left-4 text-neutral-500">
                  <IconMail className="h-5 w-5" />
                </span>
                <input
                  id="admin-forgot-email"
                  type="email"
                  autoComplete="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  className="w-full rounded-full bg-transparent py-3.5 pl-12 pr-5 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
                  placeholder="admin@…"
                  aria-invalid={!!forgotError}
                  aria-describedby={forgotError ? forgotErrId : undefined}
                />
              </div>
            </div>
            {forgotError ? (
              <p id={forgotErrId} className="text-sm text-red-400" role="alert">
                {forgotError}
              </p>
            ) : null}
            {forgotNotice ? (
              <p className="text-sm text-emerald-400/90" role="status">
                {forgotNotice}
              </p>
            ) : null}
            <button type="submit" disabled={forgotBusy} className={btnPrimary}>
              {forgotBusy ? "A enviar…" : "Enviar link"}
            </button>
          </form>
        </>
      ) : (
        <>
          <div className="mb-3 flex justify-center">
            <span
              className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-xs font-semibold tracking-wide text-amber-400"
              role="status"
            >
              🛡 Acesso de system admin
            </span>
          </div>
          <h1 className="text-center font-display text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">
            Administração
          </h1>
          <p className="mt-2 text-center text-sm text-neutral-400">
            Entre com a conta autorizada (ex.: email em SYSTEM_ADMIN_EMAILS). Este ecrã é só para a
            equipa da plataforma — não é o login das clínicas.
          </p>
          <p
            className="mt-3 rounded-xl border border-amber-700/50 bg-amber-950/40 px-3 py-2.5 text-center text-xs leading-relaxed text-amber-100/90"
            role="note"
          >
            <strong className="text-amber-400">⚠</strong> Alterações no painel admin afetam todas as
            clínicas.
          </p>

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => void handleLogin(e)}
            noValidate
            aria-describedby={error ? formErrorId : undefined}
          >
            <div>
              <label
                htmlFor="admin-login-email"
                className="mb-1.5 block text-xs font-medium text-neutral-400"
              >
                Email
              </label>
              <div className={pillWrap}>
                <span className="pointer-events-none absolute left-4 text-neutral-500">
                  <IconMail className="h-5 w-5" />
                </span>
                <input
                  id="admin-login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-full bg-transparent py-3.5 pl-12 pr-5 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
                  placeholder="admin@…"
                  aria-invalid={!!error}
                />
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label
                  htmlFor="admin-login-password"
                  className="block text-xs font-medium text-neutral-400"
                >
                  Senha
                </label>
                <button
                  type="button"
                  className="text-xs font-semibold text-amber-400 underline-offset-2 hover:underline"
                  onClick={() => {
                    setView("forgot");
                    setForgotEmail(email.trim());
                    setError(null);
                  }}
                >
                  Esqueci minha senha
                </button>
              </div>
              <div className={pillWrap}>
                <span className="pointer-events-none absolute left-4 text-neutral-500">
                  <IconLock className="h-5 w-5" />
                </span>
                <input
                  id="admin-login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-full bg-transparent py-3.5 pl-12 pr-5 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
                  placeholder="••••••••"
                  aria-invalid={!!error}
                />
              </div>
            </div>

            {error ? (
              <p id={formErrorId} className="text-sm text-red-400" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "A entrar…" : "Entrar no painel admin"}
            </button>
          </form>

          <div className="relative my-7">
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
            Continuar com Conta Google
          </button>

          <p className="mt-8 text-center text-sm text-neutral-500">
            É cliente ou profissional?{" "}
            <Link
              href="/login"
              className="font-semibold text-amber-400 underline-offset-2 hover:underline"
            >
              Login do painel da clínica
            </Link>
          </p>
          <p className="mt-3 text-center text-xs text-neutral-600">
            Primeira vez:{" "}
            <Link
              href="/cadastro/admin"
              className="font-semibold text-amber-500/90 underline-offset-2 hover:underline"
            >
              Criar conta de administrador
            </Link>{" "}
            (ecrã próprio) e inclua o email em SYSTEM_ADMIN_EMAILS no servidor.
          </p>
        </>
      )}
    </AdminAuthVisualShell>
  );
}
