"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WhatsappSessionRow = {
  id: string;
  phone: string;
  numero_cliente: string | null;
  needs_human: boolean;
  staff_handling: boolean;
  manual: boolean | null;
  last_message_preview: string | null;
  updated_at: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  clinicId: string;
  onClaimed?: (phone: string) => void;
  presentation?: "modal" | "panel";
};

export function WhatsappHumanModal({
  open,
  onClose,
  supabase,
  clinicId,
  onClaimed,
  presentation = "modal",
}: Props) {
  const [rows, setRows] = useState<WhatsappSessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reactivatingPhone, setReactivatingPhone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("whatsapp_sessions")
      .select(
        "id, phone, numero_cliente, manual, needs_human, staff_handling, last_message_preview, updated_at"
      )
      .eq("clinic_id", clinicId)
      .order("updated_at", { ascending: false })
      .limit(50);
    setLoading(false);
    if (e) {
      if (
        e.message.includes("does not exist") ||
        e.code === "42P01" ||
        e.message.includes("whatsapp_sessions")
      ) {
        setError(
          "Tabela whatsapp_sessions inexistente. Execute supabase/whatsapp_sessions.sql no SQL Editor."
        );
      } else {
        setError(e.message);
      }
      setRows([]);
      return;
    }
    setRows((data ?? []) as WhatsappSessionRow[]);
  }, [supabase, clinicId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  // Realtime: recarrega quando whatsapp_sessions mudar para esta clínica
  useEffect(() => {
    if (!open) return;
    const channel = supabase
      .channel(`whatsapp_sessions_${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_sessions",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => { void load(); }
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [open, supabase, clinicId, load]);

  // Poll a cada 20s como fallback se realtime não estiver activo
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => { void load(); }, 20000);
    return () => clearInterval(t);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  async function claim(sessionId: string, phone: string) {
    setBusyId(sessionId);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
        credentials: "include",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `Erro ${res.status}`);
        setBusyId(null);
        return;
      }
      await load();
      onClaimed?.(phone);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha de rede");
    }
    setBusyId(null);
  }

  async function reactivateBot(phone: string) {
    setReactivatingPhone(phone);
    try {
      await fetch("/api/whatsapp/reactivate-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
        credentials: "include",
      });
      await load();
    } finally {
      setReactivatingPhone(null);
    }
  }

  const pending = rows.filter((r) => r.needs_human && !r.staff_handling);
  const otherRows = rows.filter((r) => !(r.needs_human && !r.staff_handling));

  if (!open) return null;

  const isPanel = presentation === "panel";

  const shell = (
      <div
        className={`w-full min-w-0 overflow-hidden rounded-2xl border border-[#e6e1d8] bg-[#F9F7F2] ${
          isPanel ? "max-h-none shadow-sm" : "max-h-[85vh] max-w-lg shadow-xl"
        }`}
        role={isPanel ? "region" : undefined}
        aria-labelledby="whatsapp-human-title"
      >
        <div className="flex items-center justify-between border-b border-[#e6e1d8] bg-white px-5 py-4">
          <h2
            id="whatsapp-human-title"
            className="font-display text-lg font-semibold text-[#2c2825]"
          >
            WhatsApp — assumir conversa
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-[#6b635a] hover:bg-[#f3efe8]"
          >
            Fechar
          </button>
        </div>
        <div className="max-h-[calc(85vh-5rem)] overflow-y-auto px-5 py-4">
          <p className="text-sm text-[#6b635a]">
            Quando o cliente pede para falar com humano, o n8n marca a sessão
            aqui. Use o número para responder manualmente no WhatsApp Business.
          </p>
          {error ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {error}
            </p>
          ) : null}
          {loading ? (
            <p className="mt-4 text-sm text-[#8a8278]">A carregar…</p>
          ) : null}
          {!loading && !error && pending.length > 0 ? (
            <div className="mt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#b45309]">
                Pedido de humano ({pending.length})
              </p>
              <ul className="space-y-2">
                {pending.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-[#f0d9c4] bg-white p-3 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-sm font-semibold text-[#2c2825]">
                        {r.phone}
                      </span>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void claim(r.id, r.phone)}
                        className="rounded-lg bg-[#4D6D66] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3f5c56] disabled:opacity-50"
                      >
                        {busyId === r.id
                          ? "…"
                          : `Assumir WhatsApp [${r.numero_cliente || r.phone}]`}
                      </button>
                    </div>
                    {r.last_message_preview ? (
                      <p className="mt-2 line-clamp-2 text-xs text-[#6b635a]">
                        {r.last_message_preview}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!loading && !error && pending.length === 0 && otherRows.length > 0 ? (
            <p className="mt-4 text-sm text-[#6b635a]">
              Nenhum pedido de humano pendente. Últimas sessões abaixo.
            </p>
          ) : null}
          {!loading && !error && otherRows.length > 0 ? (
            <ul className="mt-4 space-y-2 border-t border-[#ebe6dd] pt-4">
              {otherRows.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e6e1d8] bg-white/80 px-3 py-2 text-xs"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-[#2c2825]">{r.phone}</span>
                    {r.last_message_preview ? (
                      <span className="truncate text-[#8a8278]">{r.last_message_preview}</span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.staff_handling ? (
                      <button
                        type="button"
                        disabled={reactivatingPhone === r.phone}
                        onClick={() => void reactivateBot(r.phone)}
                        className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {reactivatingPhone === r.phone ? "…" : "Ativar agente"}
                      </button>
                    ) : null}
                    <span className="text-[#8a8278]">
                      {r.staff_handling
                        ? "Humano ativo"
                        : r.needs_human
                          ? "Aguardando"
                          : "Bot"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {!loading && !error && rows.length === 0 ? (
            <p className="mt-4 text-sm text-[#8a8278]">
              Ainda não há sessões WhatsApp registadas para esta clínica.
            </p>
          ) : null}
        </div>
      </div>
  );

  if (isPanel) {
    return (
      <div className="w-full min-w-0 pb-2" role="region" aria-label="WhatsApp humano">
        {shell}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whatsapp-human-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {shell}
    </div>
  );
}
