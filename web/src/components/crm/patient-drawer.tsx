"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CrmFunilStatus } from "@/lib/crm-funil";
import { funilLabels, FunilBadge, normalizeFunil } from "@/components/crm/funil-badges";

export type PacienteRow = {
  id: string;
  nome: string | null;
  telefone: string | null;
  tags: string[];
  notas: string | null;
  status_funil?: string | null;
  origem?: string | null;
  status_relacionamento?: string;
  ultima_consulta: string | null;
  total_consultas: number;
};

type AgRow = {
  id: string;
  data_agendamento: string;
  horario: string;
  status: string;
  profissional: string;
  servico: string;
  source: string;
  observacoes?: string | null;
};

type IntRow = {
  id: string;
  tipo: string;
  resumo: string;
  created_at: string;
};

type TaskRow = {
  id: string;
  titulo: string;
  due_date: string;
};

type Props = {
  clinicId: string;
  open: boolean;
  paciente: PacienteRow | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function PatientDrawer({ clinicId, open, paciente, canEdit, onClose, onSaved }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [notas, setNotas] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [funil, setFunil] = useState<CrmFunilStatus>("lead");
  const [origem, setOrigem] = useState("");
  const [saving, setSaving] = useState(false);
  const [agendamentos, setAgendamentos] = useState<AgRow[]>([]);
  const [interacoes, setInteracoes] = useState<IntRow[]>([]);
  const [pendentes, setPendentes] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [taskTitulo, setTaskTitulo] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [intResumo, setIntResumo] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDetalhe = useCallback(async () => {
    if (!paciente?.id || !open) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clinica/${encodeURIComponent(clinicId)}/crm/pacientes/${encodeURIComponent(paciente.id)}/detalhe`,
        { credentials: "same-origin" }
      );
      const j = (await res.json().catch(() => ({}))) as {
        agendamentos?: AgRow[];
        interacoes?: IntRow[];
        tarefas_pendentes?: TaskRow[];
      };
      if (res.ok) {
        setAgendamentos(Array.isArray(j.agendamentos) ? j.agendamentos : []);
        setInteracoes(Array.isArray(j.interacoes) ? j.interacoes : []);
        setPendentes(Array.isArray(j.tarefas_pendentes) ? j.tarefas_pendentes : []);
      }
    } finally {
      setLoading(false);
    }
  }, [clinicId, paciente?.id, open]);

  useEffect(() => {
    if (!open || !paciente) return;
    setNotas(paciente.notas ?? "");
    setTagsText((paciente.tags ?? []).join(", "));
    setFunil(normalizeFunil(paciente.status_funil));
    setOrigem(paciente.origem ?? "");
    setTaskTitulo("");
    setTaskDue("");
    setIntResumo("");
    void loadDetalhe();
  }, [open, paciente, loadDetalhe]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  async function patchCliente(body: Record<string, unknown>) {
    if (!paciente || !canEdit) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/clinica/${encodeURIComponent(clinicId)}/crm/pacientes`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: paciente.id, ...body }),
      });
      if (res.ok) onSaved();
    } finally {
      setSaving(false);
    }
  }

  function scheduleNotasSave(value: string) {
    if (!canEdit) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void patchCliente({ notas: value });
    }, 650);
  }

  async function saveTagsOrigemFunil() {
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await patchCliente({
      tags,
      origem: origem.trim() || null,
      status_funil: funil,
    });
  }

  async function addTask() {
    if (!paciente || !taskTitulo.trim() || !taskDue || !canEdit) return;
    const res = await fetch(`/api/clinica/${encodeURIComponent(clinicId)}/crm/tarefas`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cliente_id: paciente.id,
        titulo: taskTitulo.trim(),
        due_date: taskDue,
      }),
    });
    if (res.ok) {
      setTaskTitulo("");
      void loadDetalhe();
      onSaved();
    }
  }

  async function addInteracao() {
    if (!paciente || !intResumo.trim() || !canEdit) return;
    const res = await fetch(`/api/clinica/${encodeURIComponent(clinicId)}/crm/interacoes`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cliente_id: paciente.id,
        tipo: "nota",
        resumo: intResumo.trim(),
      }),
    });
    if (res.ok) {
      setIntResumo("");
      void loadDetalhe();
    }
  }

  if (!open || !paciente) return null;

  return (
    <div className="fixed inset-0 z-[120] flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        aria-label="Fechar painel"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-drawer-title"
        className="relative flex h-full w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl outline-none sm:max-w-lg"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4">
          <div className="min-w-0">
            <p id="crm-drawer-title" className="font-display text-lg font-semibold text-[var(--text)]">
              {paciente.nome ?? "Paciente"}
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{paciente.telefone ?? "—"}</p>
            <div className="mt-2">
              <FunilBadge status={funil} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-soft)]"
          >
            Fechar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {canEdit ? (
            <>
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--text-muted)]">Estado no funil</label>
                <select
                  value={funil}
                  onChange={(e) => setFunil(e.target.value as CrmFunilStatus)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  {funilLabels().map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--text-muted)]">Tags (separadas por vírgula)</label>
                <input
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
                  placeholder="vip, implantologia"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-[var(--text-muted)]">Origem (opcional)</label>
                <input
                  value={origem}
                  onChange={(e) => setOrigem(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
                  placeholder="Indicação, Instagram…"
                />
              </div>
              <button
                type="button"
                onClick={() => void saveTagsOrigemFunil()}
                disabled={saving}
                className="rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "A guardar…" : "Guardar funil, tags e origem"}
              </button>
            </>
          ) : null}

          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--text-muted)]">Notas</label>
            <textarea
              disabled={!canEdit}
              value={notas}
              onChange={(e) => {
                setNotas(e.target.value);
                scheduleNotasSave(e.target.value);
              }}
              rows={5}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-60"
            />
            {canEdit ? (
              <p className="text-[10px] text-[var(--text-muted)]">Gravação automática ao parar de escrever.</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Tarefas pendentes
            </h3>
            {pendentes.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Nenhuma.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {pendentes.map((t) => (
                  <li key={t.id} className="rounded-lg border border-[var(--border)] px-2 py-1.5">
                    <span className="font-medium text-[var(--text)]">{t.titulo}</span>
                    <span className="text-[var(--text-muted)]"> · {t.due_date}</span>
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? (
              <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                <p className="text-xs font-medium text-[var(--text)]">Nova tarefa de follow-up</p>
                <input
                  value={taskTitulo}
                  onChange={(e) => setTaskTitulo(e.target.value)}
                  placeholder="Título"
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                />
                <input
                  type="date"
                  value={taskDue}
                  onChange={(e) => setTaskDue(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void addTask()}
                  className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-white"
                >
                  Adicionar tarefa
                </button>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Histórico de agendamentos
            </h3>
            {loading ? (
              <p className="text-sm text-[var(--text-muted)]">A carregar…</p>
            ) : agendamentos.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Sem registos.</p>
            ) : (
              <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
                {agendamentos.map((a) => (
                  <li
                    key={String(a.id)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-2"
                  >
                    <div className="font-medium text-[var(--text)]">
                      {a.data_agendamento} {a.horario} · {a.status}
                    </div>
                    <div className="text-[var(--text-muted)]">{a.profissional} — {a.servico}</div>
                    <div className="text-[10px] uppercase text-[var(--primary)]">{a.source}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Interações registadas
            </h3>
            {canEdit ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={intResumo}
                  onChange={(e) => setIntResumo(e.target.value)}
                  placeholder="Registar contacto ou nota…"
                  rows={2}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void addInteracao()}
                  className="self-start rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium"
                >
                  Registar interação
                </button>
              </div>
            ) : null}
            {interacoes.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Nenhuma interação manual.</p>
            ) : (
              <ul className="max-h-40 space-y-2 overflow-y-auto text-sm">
                {interacoes.map((i) => (
                  <li key={i.id} className="rounded-lg border border-[var(--border)] px-2 py-2">
                    <div className="text-[10px] text-[var(--text-muted)]">
                      {new Date(i.created_at).toLocaleString()} · {i.tipo}
                    </div>
                    <div className="text-[var(--text)]">{i.resumo}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
