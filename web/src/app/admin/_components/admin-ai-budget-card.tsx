"use client";

import { useEffect, useState } from "react";

type Status = {
  budget_usd: number;
  budget_brl: number;
  spent_total_usd: number;
  spent_total_brl: number;
  spent_mes_atual_usd: number;
  spent_mes_atual_brl: number;
  remaining_usd: number;
  remaining_brl: number;
  pct_used: number;
  updated_at: string | null;
  usd_brl_rate: number;
};

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const brlFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function AdminAiBudgetCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-budget", { credentials: "same-origin" });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: Status;
        error?: string;
        message?: string;
      };
      if (!res.ok || !j.ok || !j.status) {
        setError(j.message ?? j.error ?? `Erro ${res.status}`);
        return;
      }
      setStatus(j.status);
      setDraft(j.status.budget_usd.toFixed(2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha de rede.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    const n = Number(draft.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      setError("Valor inválido.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-budget", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget_usd: n }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: Status;
        error?: string;
        message?: string;
      };
      if (!res.ok || !j.ok || !j.status) {
        setError(j.message ?? j.error ?? `Erro ${res.status}`);
        return;
      }
      setStatus(j.status);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha de rede.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mb-6 rounded-2xl border border-neutral-700 bg-neutral-900/40 px-5 py-4 text-sm text-neutral-400">
        A carregar saldo…
      </div>
    );
  }

  if (!status) {
    return (
      <div className="mb-6 rounded-2xl border border-red-700/40 bg-red-950/30 px-5 py-4 text-sm text-red-200">
        {error ?? "Saldo indisponível."}
      </div>
    );
  }

  const pct = Math.min(status.pct_used, 100);
  const noBudget = status.budget_usd === 0;
  const barColor =
    noBudget || pct < 70
      ? "bg-emerald-500"
      : pct < 90
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div className="mb-6 rounded-2xl border border-neutral-700 bg-neutral-900/60 px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Saldo OpenAI
          </h2>
          {noBudget ? (
            <p className="mt-1 text-sm text-neutral-300">
              Define um orçamento para acompanhar o saldo restante.
            </p>
          ) : (
            <p className="mt-1 text-2xl font-semibold text-neutral-100">
              {usdFmt.format(status.remaining_usd)}{" "}
              <span className="text-base font-normal text-neutral-400">
                · {brlFmt.format(status.remaining_brl)} restantes
              </span>
            </p>
          )}
          <p className="mt-1 text-xs text-neutral-500">
            Gasto total: {usdFmt.format(status.spent_total_usd)} ·{" "}
            {brlFmt.format(status.spent_total_brl)} (este mês:{" "}
            {usdFmt.format(status.spent_mes_atual_usd)})
            {!noBudget ? ` · ${status.pct_used.toFixed(1)}% do orçamento` : null}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          {!editing ? (
            <>
              <span className="text-[11px] text-neutral-500">
                Orçamento: {usdFmt.format(status.budget_usd)}
              </span>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-md border border-amber-500/40 bg-neutral-800 px-2.5 py-1 text-xs text-amber-200 hover:bg-neutral-700"
              >
                {noBudget ? "Definir orçamento" : "Editar orçamento"}
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400">USD</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={saving}
                className="w-28 rounded-md border border-neutral-600 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-50"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft(status.budget_usd.toFixed(2));
                  setError(null);
                }}
                disabled={saving}
                className="rounded-md border border-neutral-600 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>

      {!noBudget ? (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
          <div
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-red-300">{error}</p>
      ) : null}
    </div>
  );
}
