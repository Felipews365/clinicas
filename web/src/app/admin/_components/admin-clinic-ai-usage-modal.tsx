"use client";

import { useEffect, useState } from "react";
import type { AdminClinicRow } from "@/lib/admin/clinics-data";

type BreakdownRow = {
  agent: string;
  model: string;
  chamadas: number;
  prompt_tokens: number;
  completion_tokens: number;
  tokens: number;
  cost_usd: number;
  cost_brl: number;
};

type Props = {
  clinic: AdminClinicRow;
  onClose: () => void;
};

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const brlFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const intFmt = new Intl.NumberFormat("pt-BR");

const AGENT_LABEL: Record<string, string> = {
  qualificador: "Qualificador (triagem)",
  agendador: "Agendador",
  faq: "FAQ",
  especialista: "Especialista procedimentos",
  lembretes: "Lembretes inteligentes",
  whisper: "Transcrição de áudio",
  vision: "Descrição de imagem",
};

function agentLabel(a: string): string {
  return AGENT_LABEL[a] ?? a;
}

export function AdminClinicAiUsageModal({ clinic, onClose }: Props) {
  const [periodo, setPeriodo] = useState<"mes" | "total">("mes");
  const [rows, setRows] = useState<BreakdownRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/clinicas/${encodeURIComponent(clinic.id)}/ai-usage?periodo=${periodo}`,
          { credentials: "same-origin" }
        );
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          breakdown?: BreakdownRow[];
          error?: string;
          message?: string;
        };
        if (cancelled) return;
        if (!res.ok || !j.ok) {
          setError(j.message ?? j.error ?? `Erro ${res.status}`);
          setRows([]);
          return;
        }
        setRows(j.breakdown ?? []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Falha de rede.");
        setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [clinic.id, periodo]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totalUsd = (rows ?? []).reduce((s, r) => s + r.cost_usd, 0);
  const totalBrl = (rows ?? []).reduce((s, r) => s + r.cost_brl, 0);
  const totalChamadas = (rows ?? []).reduce((s, r) => s + r.chamadas, 0);
  const totalTokens = (rows ?? []).reduce((s, r) => s + r.tokens, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-neutral-700 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              Custo de IA — {clinic.name}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-neutral-500">
              {clinic.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-6 py-3">
          <div className="inline-flex overflow-hidden rounded-md border border-neutral-700">
            <button
              type="button"
              onClick={() => setPeriodo("mes")}
              className={`px-3 py-1 text-xs ${
                periodo === "mes"
                  ? "bg-amber-500 text-neutral-950"
                  : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              Este mês
            </button>
            <button
              type="button"
              onClick={() => setPeriodo("total")}
              className={`px-3 py-1 text-xs ${
                periodo === "total"
                  ? "bg-amber-500 text-neutral-950"
                  : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              Total acumulado
            </button>
          </div>
          <span className="text-[11px] text-neutral-500">
            cotação: 1 USD = R$ {clinic.usd_brl_rate.toFixed(2)}
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-neutral-400">
              A carregar…
            </p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-300">{error}</p>
          ) : rows && rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">
              Sem chamadas registadas neste período.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-2 py-2 font-medium">Agente</th>
                  <th className="px-2 py-2 text-right font-medium">Chamadas</th>
                  <th className="px-2 py-2 text-right font-medium">Tokens</th>
                  <th className="px-2 py-2 text-right font-medium">USD</th>
                  <th className="px-2 py-2 text-right font-medium">BRL</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr
                    key={r.agent}
                    className="border-b border-neutral-800/70 text-neutral-300 last:border-0"
                  >
                    <td className="px-2 py-2">
                      <span className="text-neutral-100">
                        {agentLabel(r.agent)}
                      </span>
                      <span className="mt-0.5 block font-mono text-[11px] text-neutral-500">
                        {r.model}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs">
                      {intFmt.format(r.chamadas)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs">
                      {intFmt.format(r.tokens)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs text-neutral-100">
                      {usdFmt.format(r.cost_usd)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs text-neutral-100">
                      {brlFmt.format(r.cost_brl)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows && rows.length > 0 ? (
                <tfoot>
                  <tr className="border-t-2 border-neutral-700 text-neutral-100">
                    <td className="px-2 py-2 font-semibold">Total</td>
                    <td className="px-2 py-2 text-right font-mono text-xs">
                      {intFmt.format(totalChamadas)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs">
                      {intFmt.format(totalTokens)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs font-semibold">
                      {usdFmt.format(totalUsd)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs font-semibold">
                      {brlFmt.format(totalBrl)}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
