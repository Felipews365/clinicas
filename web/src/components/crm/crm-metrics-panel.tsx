"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type OrigemRow = { label: string; count: number };
type TopPro = { profissional: string; total: number };

type MetricasPayload = {
  taxa_retorno: number | null;
  total_com_consulta?: number;
  total_com_retorno?: number;
  total_inativos_60d: number;
  total_sumidos_90d: number;
  origens: OrigemRow[];
  top_profissionais_mes: TopPro[];
  mes_referencia_ini?: string;
  mes_referencia_fim?: string;
};

const PIE_COLORS = ["#58b8ae", "#f0a030", "#6b8cff", "#e85d75", "#9b8cff", "#5c7472"];

type Props = {
  clinicId: string;
};

export function CrmMetricsPanel({ clinicId }: Props) {
  const [data, setData] = useState<MetricasPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/clinica/${encodeURIComponent(clinicId)}/crm/metricas`,
        { credentials: "same-origin" }
      );
      const j = (await res.json().catch(() => ({}))) as {
        metricas?: MetricasPayload;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error ?? `Erro ${res.status}`);
        setData(null);
        return;
      }
      setData((j.metricas as MetricasPayload) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pieData = useMemo(
    () =>
      (data?.origens ?? []).map((o) => ({
        name: o.label,
        value: o.count,
      })),
    [data?.origens]
  );

  if (loading) {
    return <p className="text-sm text-[var(--text-muted)]">A carregar métricas…</p>;
  }
  if (error || !data) {
    return <p className="text-sm text-red-600 dark:text-red-300">{error ?? "Sem dados."}</p>;
  }

  const taxaPct =
    data.taxa_retorno != null ? `${Math.round(data.taxa_retorno * 10000) / 100}%` : "—";

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Taxa de retorno" value={taxaPct} hint="≥2 consultas / ≥1 consulta" />
        <MetricCard title="Inactivos +60 dias" value={String(data.total_inativos_60d)} />
        <MetricCard title="Sumidos +90 dias" value={String(data.total_sumidos_90d)} />
        <MetricCard
          title="Mês (referência)"
          value={
            data.mes_referencia_ini && data.mes_referencia_fim
              ? `${data.mes_referencia_ini.slice(0, 7)}`
              : "—"
          }
          hint="Top profissionais neste mês"
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text)]">Pacientes por origem</h3>
          <div className="mt-4 h-[280px] w-full">
            {pieData.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Sem dados para o gráfico.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={88}
                    label={({ name, percent }) =>
                      `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`
                    }
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text)]">Top 5 profissionais (mês)</h3>
          <ol className="mt-4 space-y-2">
            {(data.top_profissionais_mes ?? []).length === 0 ? (
              <li className="text-sm text-[var(--text-muted)]">Sem atendimentos no período.</li>
            ) : (
              (data.top_profissionais_mes ?? []).map((row, i) => (
                <li
                  key={`${row.profissional}-${i}`}
                  className="flex justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm"
                >
                  <span className="text-[var(--text)]">
                    {i + 1}. {row.profissional}
                  </span>
                  <span className="font-medium tabular-nums text-[var(--primary)]">{row.total}</span>
                </li>
              ))
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-[var(--primary)]">
        {value}
      </p>
      {hint ? <p className="mt-1 text-[10px] text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}
