"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { friendlyAuthError } from "@/lib/auth-errors";
import { safePostLoginNext } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase/client";
import { AuthVisualShell } from "./auth-visual-shell";
import { IconGoogle, IconLock, IconMail } from "./auth-icons";

const pillWrap =
  "relative flex items-center rounded-full border border-transparent bg-slate-100 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] transition focus-within:border-[#0047AB]/35 focus-within:ring-2 focus-within:ring-[#0047AB]/20";

const btnPrimary =
  "w-full rounded-full bg-[#0047AB] py-3.5 text-sm font-semibold text-white shadow-md transition hover:bg-[#003a94] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0047AB] disabled:opacity-50";

const btnGoogle =
  "flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white py-3.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50";

export function ClinicLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const afterLoginPath = useMemo(
    () => safePostLoginNext(searchParams.get("next")),
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
    router.replace(qs ? `/login?${qs}` : "/login", { scroll: false });
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
      <AuthVisualShell>
        <p className="text-center text-sm text-red-600">
          Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY em
          .env.local.
        </p>
      </AuthVisualShell>
    );
  }

  return (
    <AuthVisualShell>
      {view === "forgot" ? (
        <>
          <h1 className="text-center font-display text-2xl font-semibold tracking-tight text-slate-900">
            Recuperar senha
          </h1>
          <p className="mt-2 text-center text-sm text-slate-600">
            Enviaremos um link seguro para o seu email.
          </p>
          <form
            className="mt-8 space-y-5"
            onSubmit={(e) => void handleForgot(e)}
            noValidate
          >
            <button
              type="button"
              className="text-sm font-medium text-[#0047AB] underline-offset-2 hover:underline"
              onClick={() => {
                setView("login");
                setForgotError(null);
                setForgotNotice(null);
              }}
            >
              ← Voltar ao login
            </button>
            <div>
              <label
                htmlFor="forgot-email"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Email
              </label>
              <div className={pillWrap}>
                <span className="pointer-events-none absolute left-4 text-slate-400">
                  <IconMail className="h-5 w-5" />
                </span>
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  className="w-full rounded-full bg-transparent py-3.5 pl-12 pr-5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  placeholder="seu@email.com"
                  aria-invalid={!!forgotError}
                  aria-describedby={forgotError ? forgotErrId : undefined}
                />
              </div>
            </div>
            {forgotError ? (
              <p
                id={forgotErrId}
                className="text-sm text-red-600"
                role="alert"
              >
                {forgotError}
              </p>
            ) : null}
            {forgotNotice ? (
              <p className="text-sm text-emerald-700" role="status">
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
          <h1 className="text-center font-display text-2xl font-semibold tracking-tight text-slate-900 sm:text-[1.75rem]">
            Bem-vindo
          </h1>
          <p className="mt-2 text-center text-sm text-slate-600">
            Entre no painel da sua clínica.
          </p>

          <form
            className="mt-8 space-y-4"
            onSubmit={(e) => void handleLogin(e)}
            noValidate
            aria-describedby={error ? formErrorId : undefined}
          >
            <div>
              <label
                htmlFor="login-email"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Email
              </label>
              <div className={pillWrap}>
                <span className="pointer-events-none absolute left-4 text-slate-400">
                  <IconMail className="h-5 w-5" />
                </span>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-full bg-transparent py-3.5 pl-12 pr-5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  placeholder="seu@email.com"
                  aria-invalid={!!error}
                />
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-medium text-slate-600"
                >
                  Senha
                </label>
                <button
                  type="button"
                  className="text-xs font-semibold text-[#0047AB] underline-offset-2 hover:underline"
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
                <span className="pointer-events-none absolute left-4 text-slate-400">
                  <IconLock className="h-5 w-5" />
                </span>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-full bg-transparent py-3.5 pl-12 pr-5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  placeholder="••••••••"
                  aria-invalid={!!error}
                />
              </div>
            </div>

            {error ? (
              <p id={formErrorId} className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "A entrar…" : "Entrar"}
            </button>
          </form>

          <div className="relative my-7">
            <div className="absolute inset-0 flex items-center" aria-hidden>
              <span className="w-full border-t border-slate-200" />
            </div>
            <p className="relative mx-auto w-fit bg-white px-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">
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

          <p className="mt-8 text-center text-sm text-slate-600">
            Ainda não tem conta?{" "}
            <Link
              href="/cadastro"
              className="font-semibold text-[#0047AB] underline-offset-2 hover:underline"
            >
              Criar conta
            </Link>
          </p>
        </>
      )}
    </AuthVisualShell>
  );
}
