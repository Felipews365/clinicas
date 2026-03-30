"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { friendlyAuthError } from "@/lib/auth-errors";
import { createClient } from "@/lib/supabase/client";

const inputClass =
  "mt-2 w-full rounded-xl border border-stone-200/90 bg-white/90 px-4 py-3 text-[15px] text-stone-900 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-[#4D6D66] focus:ring-2 focus:ring-[#4D6D66]/25 dark:border-zinc-600 dark:bg-zinc-900/90 dark:text-zinc-100 dark:focus:border-[#6b9088] dark:focus:ring-[#6b9088]/25";

export default function RedefinirSenhaPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const errId = useId();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
      setReady(true);
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== password2) {
      setError("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    const { error: upErr } = await supabase.auth.updateUser({
      password,
    });
    setBusy(false);
    if (upErr) {
      setError(friendlyAuthError(upErr.message));
      return;
    }
    router.push("/login");
    router.refresh();
  }

  if (!supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3efe6] px-4">
        <p className="text-center text-sm text-red-700">
          Configure as variáveis Supabase em .env.local.
        </p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3efe6]">
        <p className="text-sm text-stone-500">A carregar…</p>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#f3efe6] px-4">
        <div className="max-w-md rounded-3xl border border-white/50 bg-white/80 p-8 text-center shadow-lg backdrop-blur-xl">
          <h1 className="font-display text-xl font-semibold text-stone-900">
            Link inválido ou expirado
          </h1>
          <p className="mt-3 text-sm text-stone-600">
            Peça um novo email de recuperação na página de login.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-xl bg-[#3d5852] px-5 py-3 text-sm font-semibold text-white hover:bg-[#354a45]"
          >
            Ir para o login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#f3efe6]">
      <div
        className="pointer-events-none fixed inset-0 bg-gradient-to-br from-[#dfece8]/90 via-[#f3efe6] to-[#ebe4d6]"
        aria-hidden
      />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
        <div className="rounded-3xl border border-white/50 bg-white/75 p-8 shadow-xl backdrop-blur-xl sm:p-10">
          <h1 className="font-display text-2xl font-semibold text-stone-900">
            Nova senha
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            Escolha uma senha forte para a sua conta.
          </p>
          <form
            className="mt-8 space-y-5"
            onSubmit={(e) => void handleSubmit(e)}
            noValidate
          >
            <div>
              <label
                htmlFor="new-pw"
                className="text-sm font-medium text-stone-800"
              >
                Nova senha
              </label>
              <input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className={inputClass}
                aria-invalid={!!error}
                aria-describedby={error ? errId : undefined}
              />
            </div>
            <div>
              <label
                htmlFor="new-pw2"
                className="text-sm font-medium text-stone-800"
              >
                Confirmar senha
              </label>
              <input
                id="new-pw2"
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                minLength={6}
                className={inputClass}
              />
            </div>
            {error ? (
              <p id={errId} className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-[#3d5852] px-4 py-3.5 text-sm font-semibold text-white shadow-md hover:bg-[#354a45] disabled:opacity-50"
            >
              {busy ? "A guardar…" : "Guardar senha"}
            </button>
          </form>
          <p className="mt-6 text-center">
            <Link
              href="/login"
              className="text-sm font-medium text-[#4D6D66] underline-offset-2 hover:underline"
            >
              Voltar ao login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
