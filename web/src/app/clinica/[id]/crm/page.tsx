"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CrmKanban } from "@/components/crm/crm-kanban";
import { CrmMetricsPanel } from "@/components/crm/crm-metrics-panel";
import { CrmTasksPanel } from "@/components/crm/crm-tasks-panel";
import { FunilBadge, normalizeFunil } from "@/components/crm/funil-badges";
import type { PacienteRow } from "@/components/crm/patient-drawer";
import { PatientDrawer } from "@/components/crm/patient-drawer";
import { ThemeToggle } from "@/components/theme-toggle";
import { CRM_PLAN_REQUIRED_RESPONSE } from "@/lib/crm-access";
import type { CrmFunilStatus } from "@/lib/crm-funil";
import { CRM_FUNIL_STATUS } from "@/lib/crm-funil";
import { getSupportWhatsAppActivatePlanUrl } from "@/lib/support-whatsapp";

function addDaysIso(base: Date, days: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function inactiveOver60Days(ultima: string | null): boolean {
  if (ultima == null || ultima === "") return true;
  const cutoff = addDaysIso(new Date(), -60);
  return ultima < cutoff;
}

function AlertStaleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type TabKey = "lista" | "pipeline" | "tarefas" | "metricas";

export default function ClinicaCrmPage() {
  const params = useParams();
  const clinicId = typeof params.id === "string" ? params.id : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planError, setPlanError] = useState(false);
  const [pacientes, setPacientes] = useState<PacienteRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);

  const [tab, setTab] = useState<TabKey>("lista");
  const [drawerPatientId, setDrawerPatientId] = useState<string | null>(null);

  const [filtroFunil, setFiltroFunil] = useState<string>("");
  const [filtroTag, setFiltroTag] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroAte, setFiltroAte] = useState("");
  const [filtroRelacao, setFiltroRelacao] = useState<string>("");

  const [reMsg, setReMsg] = useState("");
  const [reSaving, setReSaving] = useState(false);

  const mapPaciente = useCallback((raw: Record<string, unknown>): PacienteRow => {
    const tagsRaw = raw.tags;
    const tags = Array.isArray(tagsRaw) ? tagsRaw.map(String) : [];
    return {
      id: String(raw.id ?? ""),
      nome: raw.nome == null ? null : String(raw.nome),
      telefone: raw.telefone == null ? null : String(raw.telefone),
      tags,
      notas: raw.notas == null ? null : String(raw.notas),
      status_funil:
        raw.status_funil == null ? "lead" : String(raw.status_funil),
      origem: raw.origem == null ? null : String(raw.origem),
      status_relacionamento: String(raw.status_relacionamento ?? "ativo"),
      ultima_consulta: raw.ultima_consulta == null ? null : String(raw.ultima_consulta).slice(0, 10),
      total_consultas: Number(raw.total_consultas ?? 0),
    };
  }, []);

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    setPlanError(false);
    try {
      const res = await fetch(
        `/api/clinica/${encodeURIComponent(clinicId)}/crm/pacientes`,
        { credentials: "same-origin" }
      );
      const json = (await res.json().catch(() => ({}))) as {
        pacientes?: unknown;
        canEdit?: boolean;
        error?: string;
        required_plan?: string;
      };
      if (res.status === 403 && json.error === CRM_PLAN_REQUIRED_RESPONSE.error) {
        setPlanError(true);
        setPacientes([]);
        return;
      }
      if (!res.ok) {
        setError(json.error ?? `Erro ${res.status}`);
        setPacientes([]);
        return;
      }
      const raw = json.pacientes;
      const list: PacienteRow[] = Array.isArray(raw)
        ? (raw as Record<string, unknown>[]).map(mapPaciente)
        : [];
      setPacientes(list);
      setCanEdit(!!json.canEdit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar.");
      setPacientes([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId, mapPaciente]);

  useEffect(() => {
    void load();
  }, [load]);

  const assinaturaLoad = useCallback(async () => {
    if (!clinicId || !canEdit) return;
    try {
      const res = await fetch(
        `/api/clinica/${encodeURIComponent(clinicId)}/assinatura`,
        { credentials: "same-origin" }
      );
      const j = (await res.json().catch(() => ({}))) as {
        fields?: { crm_reengagement_message?: string | null };
      };
      const m = j.fields?.crm_reengagement_message;
      setReMsg(typeof m === "string" ? m : "");
    } catch {
      /* ignore */
    }
  }, [clinicId, canEdit]);

  useEffect(() => {
    void assinaturaLoad();
  }, [assinaturaLoad]);

  const drawerPaciente = useMemo(
    () => (drawerPatientId ? pacientes.find((p) => p.id === drawerPatientId) ?? null : null),
    [drawerPatientId, pacientes]
  );

  const filtered = useMemo(() => {
    const tagNeedle = filtroTag.trim().toLowerCase();
    return pacientes.filter((p) => {
      if (filtroFunil && normalizeFunil(p.status_funil) !== filtroFunil) return false;
      if (filtroRelacao && p.status_relacionamento !== filtroRelacao) return false;
      if (tagNeedle) {
        const tags = (p.tags ?? []).map((t) => t.toLowerCase());
        if (!tags.some((t) => t.includes(tagNeedle))) return false;
      }
      const u = p.ultima_consulta;
      if (filtroDesde && (!u || u < filtroDesde)) return false;
      if (filtroAte && (!u || u > filtroAte)) return false;
      return true;
    });
  }, [pacientes, filtroFunil, filtroRelacao, filtroTag, filtroDesde, filtroAte]);

  async function saveReengagement() {
    if (!canEdit) return;
    setReSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/clinica/${encodeURIComponent(clinicId)}/crm/settings`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ crm_reengagement_message: reMsg }),
        }
      );
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status === 403 && j.error === CRM_PLAN_REQUIRED_RESPONSE.error) {
          setPlanError(true);
          return;
        }
        setError(j.error ?? `Erro ${res.status}`);
      }
    } finally {
      setReSaving(false);
    }
  }

  const patchFunil = useCallback(
    async (clienteId: string, status_funil: CrmFunilStatus): Promise<boolean> => {
      let prev: PacienteRow[] = [];
      setPacientes((ps) => {
        prev = ps;
        return ps.map((p) => (p.id === clienteId ? { ...p, status_funil } : p));
      });
      try {
        const res = await fetch(`/api/clinica/${encodeURIComponent(clinicId)}/crm/pacientes`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cliente_id: clienteId, status_funil }),
        });
        if (!res.ok) {
          setPacientes(prev);
          return false;
        }
        await load();
        return true;
      } catch {
        setPacientes(prev);
        return false;
      }
    },
    [clinicId, load]
  );

  if (!clinicId) {
    return <p className="p-6 text-sm text-[var(--text-muted)]">Clínica inválida.</p>;
  }

  if (planError) {
    return (
      <div className="min-h-screen bg-[var(--bg)] px-4 py-10 text-[var(--text)]">
        <div className="mx-auto max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm">
          <h1 className="font-display text-xl font-semibold">CRM indisponível no seu plano</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Entre em contato com nosso suporte para ativar seu plano e liberar o CRM.
          </p>
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            Código: {CRM_PLAN_REQUIRED_RESPONSE.error} ({CRM_PLAN_REQUIRED_RESPONSE.required_plan})
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={getSupportWhatsAppActivatePlanUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Falar com suporte
            </a>
            <Link
              href="/painel"
              className="inline-flex rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--text)]"
            >
              Voltar ao painel
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "lista", label: "Lista" },
    { key: "pipeline", label: "Pipeline" },
    { key: "tarefas", label: "Tarefas" },
    { key: "metricas", label: "Métricas" },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <PatientDrawer
        clinicId={clinicId}
        open={drawerPatientId !== null}
        paciente={drawerPaciente}
        canEdit={canEdit}
        onClose={() => setDrawerPatientId(null)}
        onSaved={() => void load()}
      />

      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/painel"
              className="text-sm font-medium text-[var(--primary)] hover:underline"
            >
              Painel
            </Link>
            <span className="text-[var(--text-muted)]">/</span>
            <h1 className="font-display text-lg font-semibold">CRM</h1>
          </div>
          <ThemeToggle />
        </div>
        <div className="mx-auto max-w-6xl border-t border-[var(--border)] px-4">
          <nav className="-mb-px flex gap-1 overflow-x-auto py-2" aria-label="Secções CRM">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "bg-[var(--sidebar-active)] text-[var(--primary)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-soft)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
            {error}
          </div>
        ) : null}

        {canEdit ? (
          <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
            <h2 className="text-sm font-semibold">Mensagem de reengajamento (WhatsApp / n8n)</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Usada pelo fluxo automatizado para pacientes sem consulta há mais de 90 dias. Se vazio,
              usa texto padrão no servidor.
            </p>
            <textarea
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              rows={3}
              value={reMsg}
              onChange={(e) => setReMsg(e.target.value)}
              placeholder="Olá {nome}, sentimos a sua falta..."
            />
            <button
              type="button"
              onClick={() => void saveReengagement()}
              disabled={reSaving}
              className="mt-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {reSaving ? "A salvar…" : "Salvar mensagem"}
            </button>
          </section>
        ) : null}

        {tab === "lista" ? (
          <>
            <section className="mb-4 flex flex-wrap gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <label className="flex flex-col text-xs font-medium">
                Funil
                
                <select
                  className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                  value={filtroFunil}
                  onChange={(e) => setFiltroFunil(e.target.value)}
                >
                  <option value="">Todos</option>
                  {CRM_FUNIL_STATUS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-xs font-medium">
                Relação
                
                <select
                  className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                  value={filtroRelacao}
                  onChange={(e) => setFiltroRelacao(e.target.value)}
                >
                  <option value="">Todos</option>
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inactivo</option>
                  <option value="sumido">Sumido</option>
                </select>
              </label>
              <label className="flex min-w-[140px] flex-col text-xs font-medium">
                Tag contém
                <input
                  className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                  value={filtroTag}
                  onChange={(e) => setFiltroTag(e.target.value)}
                  placeholder="vip"
                />
              </label>
              <label className="flex flex-col text-xs font-medium">
                Última consulta desde
                <input
                  type="date"
                  className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                  value={filtroDesde}
                  onChange={(e) => setFiltroDesde(e.target.value)}
                />
              </label>
              <label className="flex flex-col text-xs font-medium">
                até
                
                <input
                  type="date"
                  className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
                  value={filtroAte}
                  onChange={(e) => setFiltroAte(e.target.value)}
                />
              </label>
            </section>

            {loading ? (
              <p className="text-sm text-[var(--text-muted)]">A carregar pacientes…</p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-soft)]">
                      <th className="px-3 py-2 font-semibold">Paciente</th>
                      <th className="px-3 py-2 font-semibold">Telefone</th>
                      <th className="px-3 py-2 font-semibold">Funil</th>
                      <th className="px-3 py-2 font-semibold">Relação</th>
                      <th className="px-3 py-2 font-semibold">Última consulta</th>
                      <th className="px-3 py-2 font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => {
                      const stale = inactiveOver60Days(p.ultima_consulta);
                      return (
                        <tr
                          key={p.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setDrawerPatientId(p.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setDrawerPatientId(p.id);
                            }
                          }}
                          className={
                            stale
                              ? "cursor-pointer border-b border-[var(--border)] bg-orange-500/10 hover:bg-[var(--surface-soft)] dark:bg-orange-500/15"
                              : "cursor-pointer border-b border-[var(--border)] hover:bg-[var(--surface-soft)]"
                          }
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-start gap-2">
                              {stale ? (
                                <AlertStaleIcon
                                  className="mt-0.5 shrink-0 text-orange-500"
                                  aria-label="Inactivo há mais de 60 dias"
                                />
                              ) : null}
                              <div>
                                <div className="font-medium text-[var(--text)]">
                                  {p.nome ?? "—"}
                                </div>
                                <div className="text-xs text-[var(--text-muted)]">
                                  {(p.tags ?? []).length ? p.tags.join(", ") : "—"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">{p.telefone ?? "—"}</td>
                          <td className="px-3 py-2">
                            <FunilBadge status={p.status_funil} />
                          </td>
                          <td className="px-3 py-2 capitalize text-[var(--text-muted)]">
                            {p.status_relacionamento}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {p.ultima_consulta ?? "—"}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{p.total_consultas ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtered.length === 0 ? (
                  <p className="p-6 text-center text-sm text-[var(--text-muted)]">
                    Nenhum paciente com estes filtros.
                  </p>
                ) : null}
              </div>
            )}
          </>
        ) : null}

        {tab === "pipeline" ? (
          loading ? (
            <p className="text-sm text-[var(--text-muted)]">A carregar…</p>
          ) : (
            <CrmKanban
              pacientes={pacientes}
              canEdit={canEdit}
              onPatchFunil={patchFunil}
              onOpenPatient={(p) => setDrawerPatientId(p.id)}
            />
          )
        ) : null}

        {tab === "tarefas" ? (
          <CrmTasksPanel
            clinicId={clinicId}
            pacientes={pacientes}
            canEdit={canEdit}
            onTaskDone={() => void load()}
          />
        ) : null}

        {tab === "metricas" ? <CrmMetricsPanel clinicId={clinicId} /> : null}
      </main>
    </div>
  );
}
