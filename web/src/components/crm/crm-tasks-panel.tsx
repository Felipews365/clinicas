"use client";

import { useCallback, useEffect, useState } from "react";
import type { PacienteRow } from "@/components/crm/patient-drawer";

type Task = {
  id: string;
  cliente_id: string;
  titulo: string;
  due_date: string;
  concluido_em: string | null;
  created_at: string;
};

type Filtro = "todas" | "atrasadas" | "hoje" | "futuras";

type Props = {
  clinicId: string;
  pacientes: PacienteRow[];
  canEdit: boolean;
  onTaskDone: () => void;
};

export function CrmTasksPanel({ clinicId, pacientes, canEdit, onTaskDone }: Props) {
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [tarefas, setTarefas] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [due, setDue] = useState("");
  const [clienteId, setClienteIdOption] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clinica/${encodeURIComponent(clinicId)}/crm/tarefas?filtro=${encodeURIComponent(filtro)}`,
        { credentials: "same-origin" }
      );
      const j = (await res.json().catch(() => ({}))) as { tarefas?: Task[] };
      setTarefas(Array.isArray(j.tarefas) ? j.tarefas : []);
    } finally {
      setLoading(false);
    }
  }, [clinicId, filtro]);

  useEffect(() => {
    void load();
  }, [load]);

  async function concluir(id: string) {
    if (!canEdit) return;
    setSavingId(id);
    try {
      const res = await fetch(
        `/api/clinica/${encodeURIComponent(clinicId)}/crm/tarefas/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ concluir: true }),
        }
      );
      if (res.ok) {
        void load();
        onTaskDone();
      }
    } finally {
      setSavingId(null);
    }
  }

  async function criar() {
    if (!canEdit || !titulo.trim() || !due || !clienteId) return;
    const res = await fetch(`/api/clinica/${encodeURIComponent(clinicId)}/crm/tarefas`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cliente_id: clienteId,
        titulo: titulo.trim(),
        due_date: due,
      }),
    });
    if (res.ok) {
      setTitulo("");
      setDue("");
      void load();
      onTaskDone();
    }
  }

  const nomeCliente = (id: string) =>
    pacientes.find((p) => p.id === id)?.nome ?? id.slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(["todas", "atrasadas", "hoje", "futuras"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={`rounded-full px-4 py-2 text-xs font-semibold ${
              filtro === f
                ? "bg-[var(--primary)] text-white"
                : "border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"
            }`}
          >
            {f === "todas"
              ? "Todas"
              : f === "atrasadas"
                ? "Atrasadas"
                : f === "hoje"
                  ? "Hoje"
                  : "Futuras"}
          </button>
        ))}
      </div>

      {canEdit ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text)]">Nova tarefa</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              Paciente
              <select
                value={clienteId}
                onChange={(e) => setClienteIdOption(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm"
              >
                <option value="">Escolher…</option>
                {pacientes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome ?? p.telefone ?? p.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Prazo
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              Título
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm"
                placeholder="Ligar para confirmar interesse…"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void criar()}
            className="mt-3 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Criar tarefa
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">A carregar…</p>
      ) : tarefas.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Nenhuma tarefa pendente neste filtro.</p>
      ) : (
        <ul className="space-y-2">
          {tarefas.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
            >
              {canEdit ? (
                <button
                  type="button"
                  disabled={savingId === t.id}
                  onClick={() => void concluir(t.id)}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-soft)] disabled:opacity-50"
                >
                  Concluir
                </button>
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[var(--text)]">{t.titulo}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {nomeCliente(t.cliente_id)} · {t.due_date}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
