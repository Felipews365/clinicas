"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AdminCopyButton } from "@/app/admin/_components/admin-copy-button";
import { AdminClinicAiUsageModal } from "@/app/admin/_components/admin-clinic-ai-usage-modal";
import type { AdminClinicRow } from "@/lib/admin/clinics-data";

type Props = {
  clinics: AdminClinicRow[];
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

function formatLastCall(iso: string | null): string {
  if (!iso) return "sem chamadas ainda";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `última: ${d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
}

function badge(ok: boolean | null, labelOk: string, labelBad: string) {
  if (ok === true) {
    return (
      <span className="rounded-md bg-emerald-950/60 px-2 py-0.5 text-xs text-emerald-300">
        {labelOk}
      </span>
    );
  }
  if (ok === false) {
    return (
      <span className="rounded-md bg-red-950/50 px-2 py-0.5 text-xs text-red-300">
        {labelBad}
      </span>
    );
  }
  return <span className="text-neutral-500">—</span>;
}

function daysUntil(ymd: string | null): number | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const exp = new Date(y, (m ?? 1) - 1, d ?? 1);
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

export function AdminClinicsTable({ clinics }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [usageOpenFor, setUsageOpenFor] = useState<AdminClinicRow | null>(null);
  const [, startTransition] = useTransition();

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/clinicas", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `Erro ${res.status}`);
        return;
      }
      setDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-neutral-700 bg-neutral-900/40 shadow-sm">
        <table className="w-full min-w-[1300px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-700 text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3 font-medium">Clínica</th>
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Plano</th>
              <th className="px-4 py-3 font-medium">Custo IA</th>
              <th className="px-4 py-3 font-medium">Expira</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {clinics.map((c) => {
              const busy = busyId === c.id;
              const draft = drafts[c.id] ?? c.data_expiracao ?? "";
              const dias = daysUntil(c.data_expiracao);
              const expired = dias !== null && dias < 0;
              return (
                <tr
                  key={c.id}
                  className="border-b border-neutral-800/90 align-top text-neutral-300 last:border-0"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-neutral-100">{c.name}</span>
                    {c.numero_clinica ? (
                      <span className="mt-0.5 block text-xs text-neutral-500">
                        n.º clínica: {c.numero_clinica}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-400">
                    <span
                      className="block max-w-[140px] truncate"
                      title={c.id}
                    >
                      {c.id.slice(0, 8)}…
                    </span>
                    <AdminCopyButton text={c.id} label="Copiar UUID" />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-amber-200/90">
                      {c.tipo_plano ?? "—"}
                    </span>
                    {c.plano_nome ? (
                      <span className="mt-0.5 block text-xs text-neutral-500">
                        {c.plano_nome}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className="px-4 py-3"
                    title={formatLastCall(c.ultima_chamada_at)}
                  >
                    <div className="font-mono text-xs text-neutral-100">
                      {usdFmt.format(c.cost_mes_atual_usd)}
                      <span className="text-neutral-500"> · </span>
                      {brlFmt.format(c.cost_mes_atual_brl)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-neutral-500">
                      Total: {usdFmt.format(c.cost_total_usd)} ·{" "}
                      {brlFmt.format(c.cost_total_brl)}
                    </div>
                    <button
                      type="button"
                      onClick={() => setUsageOpenFor(c)}
                      disabled={c.chamadas_total === 0}
                      className="mt-1 text-[11px] text-amber-300 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-neutral-600 disabled:no-underline"
                    >
                      Detalhes
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="date"
                      disabled={busy}
                      value={draft}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [c.id]: e.target.value }))
                      }
                      className="rounded-md border border-neutral-600 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 disabled:opacity-50"
                    />
                    {dias !== null ? (
                      <span
                        className={`mt-1 block text-[11px] ${
                          expired
                            ? "text-red-400"
                            : dias <= 7
                              ? "text-amber-300"
                              : "text-neutral-500"
                        }`}
                      >
                        {expired
                          ? `vencido há ${Math.abs(dias)}d`
                          : dias === 0
                            ? "expira hoje"
                            : `faltam ${dias}d`}
                      </span>
                    ) : (
                      <span className="mt-1 block text-[11px] text-neutral-500">
                        sem data
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {badge(c.ativo, "Ativa", "Inativa")}
                      {c.inadimplente ? (
                        <span className="rounded-md bg-orange-950/60 px-2 py-0.5 text-xs text-orange-200">
                          Inadimplente
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-600">Regular</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy || draft === (c.data_expiracao ?? "")}
                        onClick={() =>
                          void patch(c.id, {
                            data_expiracao: draft || null,
                          })
                        }
                        className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:opacity-40"
                      >
                        Salvar data
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void patch(c.id, { reset_trial: true })
                        }
                        className="rounded-md border border-amber-500/40 bg-neutral-800 px-2.5 py-1 text-xs text-amber-200 transition-colors hover:bg-neutral-700 disabled:opacity-40"
                        title="Reseta o trial para hoje + 7 dias"
                      >
                        Trial 7d
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void patch(c.id, { extend_days: 30 })
                        }
                        className="rounded-md border border-neutral-600 bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200 transition-colors hover:bg-neutral-700 disabled:opacity-40"
                      >
                        +30d
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void patch(c.id, { ativo: !(c.ativo ?? false) })
                        }
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                          c.ativo
                            ? "border border-red-500/40 bg-neutral-800 text-red-200 hover:bg-red-950/40"
                            : "border border-emerald-500/40 bg-neutral-800 text-emerald-200 hover:bg-emerald-950/40"
                        }`}
                      >
                        {c.ativo ? "Desativar" : "Reativar"}
                      </button>
                      {c.inadimplente ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void patch(c.id, { inadimplente: false })
                          }
                          className="rounded-md border border-emerald-500/40 bg-neutral-800 px-2.5 py-1 text-xs text-emerald-200 transition-colors hover:bg-emerald-950/40 disabled:opacity-40"
                        >
                          Regularizar
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {usageOpenFor ? (
        <AdminClinicAiUsageModal
          clinic={usageOpenFor}
          onClose={() => setUsageOpenFor(null)}
        />
      ) : null}
    </div>
  );
}
