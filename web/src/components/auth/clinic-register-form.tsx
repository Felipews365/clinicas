"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { friendlyAuthError } from "@/lib/auth-errors";
import {
  bootstrapClinicForUser,
  clearPendingClinicSetup,
  readPendingClinicSetup,
  savePendingClinicSetup,
  type ProfessionalDraft,
} from "@/lib/bootstrap-clinic";
import { createClient } from "@/lib/supabase/client";
import { AuthVisualShell } from "./auth-visual-shell";
import { IconGoogle, IconLock, IconMail } from "./auth-icons";

function emptyProfessional(): ProfessionalDraft {
  return { name: "", specialty: "" };
}

const pillWrap =
  "relative flex items-center rounded-full border border-transparent bg-slate-100 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] transition focus-within:border-[#0047AB]/35 focus-within:ring-2 focus-within:ring-[#0047AB]/20";

const btnPrimary =
  "w-full rounded-full bg-[#0047AB] py-3.5 text-sm font-semibold text-white shadow-md transition hover:bg-[#003a94] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0047AB] disabled:opacity-50";

const btnGoogle =
  "flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white py-3.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50";

const proCard =
  "rounded-2xl border border-slate-100 bg-slate-50/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]";

export function ClinicRegisterForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const errId = useId();
  const noticeId = useId();

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [clinicName, setClinicName] = useState("");
  const [professionals, setProfessionals] = useState<ProfessionalDraft[]>([
    emptyProfessional(),
  ]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const oauthMode = !!session?.user;

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

  useEffect(() => {
    if (!supabase || !session?.user?.id || !authReady) return;
    const pending = readPendingClinicSetup();
    if (!pending) return;
    let cancelled = false;
    void (async () => {
      const { error: bErr } = await bootstrapClinicForUser(
        supabase,
        session.user.id,
        pending
      );
      if (cancelled) return;
      if (bErr) return;
      clearPendingClinicSetup();
      router.push("/");
      router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, session?.user?.id, authReady, router]);

  async function signInWithGoogle() {
    if (!supabase) return;
    setError(null);
    setBusy(true);
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const { error: oErr } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=/cadastro`,
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

    if (!clinicName.trim()) {
      setError("Indique o nome da clínica.");
      return;
    }
    if (!professionals.some((p) => p.name.trim())) {
      setError("Indique pelo menos um profissional com nome.");
      return;
    }

    const payload = {
      clinicName: clinicName.trim(),
      professionals,
    };

    if (oauthMode && session?.user) {
      setBusy(true);
      const { error: bErr } = await bootstrapClinicForUser(
        supabase,
        session.user.id,
        payload
      );
      setBusy(false);
      if (bErr) {
        setError(bErr);
        return;
      }
      setNotice("Conta configurada. A abrir o painel…");
      router.push("/");
      router.refresh();
      return;
    }

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
        ? { emailRedirectTo: `${origin}/auth/callback?next=/cadastro` }
        : undefined,
    });
    if (signErr) {
      setError(friendlyAuthError(signErr.message));
      setBusy(false);
      return;
    }
    if (!data.user) {
      setError(
        "Não foi possível criar a conta. O email pode já estar em uso — tente entrar."
      );
      setBusy(false);
      return;
    }

    if (data.session) {
      const { error: bErr } = await bootstrapClinicForUser(
        supabase,
        data.user.id,
        payload
      );
      if (bErr) {
        setError(bErr);
        setBusy(false);
        return;
      }
      router.push("/");
      router.refresh();
    } else {
      savePendingClinicSetup(payload);
      setNotice(
        "Confirme o email (link enviado). Depois de entrar, a clínica será criada automaticamente."
      );
    }
    setBusy(false);
  }

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setEmail("");
    router.refresh();
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

  if (!authReady) {
    return (
      <AuthVisualShell>
        <p className="text-center text-sm text-slate-500">A carregar…</p>
      </AuthVisualShell>
    );
  }

  return (
    <AuthVisualShell>
      <h1 className="text-center font-display text-2xl font-semibold tracking-tight text-slate-900 sm:text-[1.75rem]">
        Cadastro da clínica
      </h1>
      <p className="mt-2 text-center text-sm text-slate-600">
        {oauthMode
          ? "Complete os dados da clínica e dos profissionais."
          : "Crie a conta e registe a sua equipa."}
      </p>

      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        aria-describedby={
          error ? errId : notice ? noticeId : undefined
        }
      >
        <div>
          <label
            htmlFor="reg-clinic"
            className="mb-1.5 block text-xs font-medium text-slate-600"
          >
            Nome da clínica
          </label>
          <div className={pillWrap}>
            <input
              id="reg-clinic"
              type="text"
              autoComplete="organization"
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
              required
              className="w-full rounded-full bg-transparent py-3.5 px-5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              placeholder="Ex.: Clínica Saúde"
            />
          </div>
        </div>

        <fieldset className="space-y-3 border-0 p-0">
          <legend className="text-xs font-medium text-slate-600">
            Profissionais
          </legend>
          <p className="text-xs text-slate-500">
            Nome e especialidade ou área. Adicione quantos precisar.
          </p>
          <ul className="space-y-3">
            {professionals.map((row, i) => (
              <li key={i} className={proCard}>
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Profissional {i + 1}
                  </span>
                  {professionals.length > 1 ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-[#0047AB] hover:underline"
                      onClick={() =>
                        setProfessionals((p) =>
                          p.length <= 1 ? p : p.filter((_, j) => j !== i)
                        )
                      }
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`reg-pro-name-${i}`}
                      className="mb-1 block text-[11px] font-medium text-slate-500"
                    >
                      Nome
                    </label>
                    <div className={pillWrap}>
                      <input
                        id={`reg-pro-name-${i}`}
                        type="text"
                        value={row.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setProfessionals((p) =>
                            p.map((x, j) => (j === i ? { ...x, name: v } : x))
                          );
                        }}
                        required={i === 0}
                        placeholder="Dra. Ana Silva"
                        className="w-full rounded-full bg-transparent py-3 px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor={`reg-pro-spec-${i}`}
                      className="mb-1 block text-[11px] font-medium text-slate-500"
                    >
                      Especialidade / área
                    </label>
                    <div className={pillWrap}>
                      <input
                        id={`reg-pro-spec-${i}`}
                        type="text"
                        value={row.specialty}
                        onChange={(e) => {
                          const v = e.target.value;
                          setProfessionals((p) =>
                            p.map((x, j) =>
                              j === i ? { ...x, specialty: v } : x
                            )
                          );
                        }}
                        placeholder="Ortodontia"
                        className="w-full rounded-full bg-transparent py-3 px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                      />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="text-sm font-semibold text-[#0047AB] hover:underline"
            onClick={() =>
              setProfessionals((p) => [...p, emptyProfessional()])
            }
          >
            + Adicionar profissional
          </button>
        </fieldset>

        {!oauthMode ? (
          <>
            <div className="relative my-2">
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
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center" aria-hidden>
                <span className="w-full border-t border-slate-200" />
              </div>
              <p className="relative mx-auto w-fit bg-white px-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                com email
              </p>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Email da conta
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {session?.user?.email ?? "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Preenchido automaticamente com a conta Google.
            </p>
            <button
              type="button"
              className="mt-3 text-xs font-semibold text-[#0047AB] underline-offset-2 hover:underline"
              onClick={() => void handleSignOut()}
            >
              Usar outro email (sair)
            </button>
          </div>
        )}

        {!oauthMode ? (
          <>
            <div>
              <label
                htmlFor="reg-email"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Email
              </label>
              <div className={pillWrap}>
                <span className="pointer-events-none absolute left-4 text-slate-400">
                  <IconMail className="h-5 w-5" />
                </span>
                <input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-full bg-transparent py-3.5 pl-12 pr-5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  placeholder="seu@email.com"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="reg-password"
                className="mb-1.5 block text-xs font-medium text-slate-600"
              >
                Senha
              </label>
              <div className={pillWrap}>
                <span className="pointer-events-none absolute left-4 text-slate-400">
                  <IconLock className="h-5 w-5" />
                </span>
                <input
                  id="reg-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full rounded-full bg-transparent py-3.5 pl-12 pr-5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
            </div>
          </>
        ) : null}

        {error ? (
          <p id={errId} className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p id={noticeId} className="text-sm text-emerald-700" role="status">
            {notice}
          </p>
        ) : null}

        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? "A processar…" : oauthMode ? "Concluir cadastro" : "Criar conta"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-slate-600">
        Já tem conta?{" "}
        <Link
          href="/login"
          className="font-semibold text-[#0047AB] underline-offset-2 hover:underline"
        >
          Entrar
        </Link>
      </p>
    </AuthVisualShell>
  );
}
