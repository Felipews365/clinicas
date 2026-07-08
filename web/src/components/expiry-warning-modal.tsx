"use client";

import { useEffect, useState } from "react";

type Props = {
  clinicId: string;
};

type AssinaturaPayload = {
  fields?: {
    data_expiracao: string | null;
    ativo: boolean;
    tipo_plano: string;
  };
};

const STORAGE_PREFIX = "expiryWarningDismissed:";

function daysUntil(ymd: string | null): number | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const exp = new Date(y, (m ?? 1) - 1, d ?? 1);
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

export function ExpiryWarningModal({ clinicId }: Props) {
  const [dias, setDias] = useState<number | null>(null);
  const [dataExp, setDataExp] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/clinica/${encodeURIComponent(clinicId)}/assinatura`,
          { credentials: "same-origin" }
        );
        if (!res.ok) return;
        const j = (await res.json().catch(() => ({}))) as AssinaturaPayload;
        if (cancelled) return;
        const exp = j.fields?.data_expiracao ?? null;
        const ativo = j.fields?.ativo !== false;
        if (!ativo || !exp) return;
        const d = daysUntil(exp);
        if (d === null || d > 3) return;
        setDataExp(exp);
        setDias(d);

        // Dismiss persistente: 1 vez por dia por (clinic_id + data_expiracao).
        const key = `${STORAGE_PREFIX}${clinicId}:${exp}`;
        try {
          const lastDismiss = window.localStorage.getItem(key);
          const todayKey = new Date().toISOString().slice(0, 10);
          if (lastDismiss !== todayKey) {
            setDismissed(false);
          }
        } catch {
          setDismissed(false);
        }
      } catch {
        // silencioso — não vamos quebrar o painel por causa do aviso
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  function handleDismiss() {
    setDismissed(true);
    if (dataExp) {
      try {
        const key = `${STORAGE_PREFIX}${clinicId}:${dataExp}`;
        window.localStorage.setItem(key, new Date().toISOString().slice(0, 10));
      } catch {
        // ignore
      }
    }
  }

  if (dismissed || dias === null) return null;

  const expirou = dias < 0;
  const expiraHoje = dias === 0;

  const titulo = expirou
    ? "Plano vencido"
    : expiraHoje
      ? "O plano expira hoje"
      : `Faltam ${dias} dia${dias === 1 ? "" : "s"} para o plano vencer`;

  const corpo = expirou
    ? "O atendimento automático pode ficar indisponível para os seus clientes. Entre em contacto com o suporte para regularizar."
    : "Entre em contacto com o suporte para renovar e evitar interrupção do atendimento automático.";

  return (
    <div
      role="alertdialog"
      aria-labelledby="expiry-warning-title"
      className="fixed bottom-4 right-4 z-50 w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-amber-500/30 bg-neutral-900/95 p-4 text-sm text-neutral-100 shadow-2xl backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 rounded-full bg-amber-500/15 p-1.5 text-amber-300">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p
            id="expiry-warning-title"
            className="font-display text-base font-semibold text-amber-100"
          >
            {titulo}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-300">{corpo}</p>
          {dataExp ? (
            <p className="mt-1.5 text-[11px] text-neutral-500">
              Data limite: <span className="font-medium text-neutral-300">{dataExp.split("-").reverse().join("/")}</span>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Fechar aviso"
          className="-mr-1 -mt-1 rounded-md p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
