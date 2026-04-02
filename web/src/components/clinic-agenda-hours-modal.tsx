"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMERCIAL_AGENDA_HOURS,
  DEFAULT_AGENDA_VISIBLE_HOURS,
  formatAgendaHourLabel,
  FULL_CLINIC_AGENDA_HOURS,
  normalizeAgendaVisibleHours,
} from "@/lib/clinic-agenda-hours";
import { professionalInitials } from "@/lib/professional-avatar";
import { resolveProfessionalCardStyle } from "@/lib/professional-palette";

type Prof = { id: string; name: string; specialty: string | null };

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  clinicId: string;
  onSaved: (hours: number[]) => void;
  presentation?: "modal" | "panel";
};

const hourBtnOn =
  "flex min-h-[2.25rem] items-center justify-center rounded-lg border border-teal-700/70 bg-teal-950/90 px-2 py-1.5 text-xs font-semibold tabular-nums text-teal-100 shadow-sm transition-[transform,box-shadow] hover:-translate-y-px hover:border-teal-600/80";
const hourBtnOff =
  "flex min-h-[2.25rem] items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1.5 text-xs font-semibold tabular-nums text-[var(--text-muted)] line-through decoration-[var(--text-muted)]/50 decoration-1 transition-colors hover:bg-[var(--surface)]";

export function ClinicAgendaHoursModal({
  open,
  onClose,
  supabase,
  clinicId,
  onSaved,
  presentation = "modal",
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(DEFAULT_AGENDA_VISIBLE_HOURS)
  );
  const [professionals, setProfessionals] = useState<Prof[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!open || !clinicId) return;
    setLoading(true);
    setError(null);
    const [cRes, pRes] = await Promise.all([
      supabase
        .from("clinics")
        .select("agenda_visible_hours")
        .eq("id", clinicId)
        .maybeSingle(),
      supabase
        .from("professionals")
        .select("id, name, specialty")
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);

    if (cRes.error) {
      setError(
        cRes.error.message +
          (cRes.error.message.includes("agenda_visible_hours")
            ? " — Execute supabase/migration_clinic_agenda_visible_hours.sql no Supabase."
            : "")
      );
      setLoading(false);
      return;
    }

    const hrs = normalizeAgendaVisibleHours(
      (cRes.data as { agenda_visible_hours?: unknown } | null)?.agenda_visible_hours
    );
    setSelected(new Set(hrs));
    setProfessionals((pRes.data ?? []) as Prof[]);
    if (pRes.error) {
      setProfessionals([]);
    }
    setLoading(false);
  }, [open, clinicId, supabase]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const sortedSelection = useMemo(
    () => [...selected].sort((a, b) => a - b),
    [selected]
  );

  function toggleHour(h: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(h)) {
        if (next.size <= 1) return prev;
        next.delete(h);
      } else {
        next.add(h);
      }
      return next;
    });
  }

  function selectAllDay() {
    setSelected(new Set(FULL_CLINIC_AGENDA_HOURS));
  }

  function selectCommercialHours() {
    setSelected(new Set(COMMERCIAL_AGENDA_HOURS));
  }

  async function handleSave() {
    if (selected.size === 0) {
      setError("Selecione pelo menos um horário.");
      return;
    }
    setSaving(true);
    setError(null);
    const hours = sortedSelection;
    const { error: e } = await supabase
      .from("clinics")
      .update({ agenda_visible_hours: hours })
      .eq("id", clinicId);
    setSaving(false);
    if (e) {
      setError(
        e.message +
          (e.message.includes("agenda_visible_hours")
            ? " — Execute supabase/migration_clinic_agenda_visible_hours.sql."
            : "")
      );
      return;
    }
    onSaved(hours);
    if (presentation !== "panel") onClose();
  }

  if (!open) return null;

  const isPanel = presentation === "panel";

  const presetToolbar = (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => selectAllDay()}
        className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--text)] shadow-sm transition-colors hover:bg-[var(--surface)]"
      >
        Tudo 6h–22h
      </button>
      <button
        type="button"
        onClick={() => selectCommercialHours()}
        className="rounded-xl border border-teal-800/40 bg-teal-950/50 px-3 py-2 text-xs font-semibold text-teal-100 shadow-sm transition-colors hover:bg-teal-950/70"
      >
        Horário comercial (8h–11h, 14h–17h)
      </button>
    </div>
  );

  const hourGrid = (
    <div
      className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(5.5rem,1fr))]"
      role="group"
      aria-label="Blocos de hora da clínica"
    >
      {FULL_CLINIC_AGENDA_HOURS.map((h) => {
        const on = selected.has(h);
        return (
          <button
            key={h}
            type="button"
            onClick={() => toggleHour(h)}
            aria-pressed={on}
            className={on ? hourBtnOn : hourBtnOff}
          >
            {formatAgendaHourLabel(h)}
          </button>
        );
      })}
    </div>
  );

  const legend = (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-[var(--text-muted)]">
      <span className="inline-flex items-center gap-1.5" title="Horário visível na agenda">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-teal-950 ring-1 ring-teal-700/80" aria-hidden />
        Na agenda
      </span>
      <span className="inline-flex items-center gap-1.5" title="Fora da grade">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-600 ring-1 ring-zinc-500/80" aria-hidden />
        Oculto
      </span>
    </div>
  );

  const doctorsBlock = (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm sm:p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Médicos ativos no painel
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        Usam apenas os horários selecionados acima nas vistas da agenda. A disponibilidade por vaga
        (WhatsApp) ajusta-se na grelha por profissional.
      </p>
      {professionals.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">Nenhum profissional ativo cadastrado.</p>
      ) : (
        <ul
          className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
        >
          {professionals.map((prof) => {
            const accent = resolveProfessionalCardStyle(null, prof.id).accent;
            const initials = professionalInitials(prof.name);
            return (
              <li
                key={prof.id}
                className="list-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white/10"
                    style={{ backgroundColor: accent }}
                    aria-hidden
                  >
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <span className="font-medium text-[var(--text)]">{prof.name}</span>
                    {prof.specialty?.trim() ? (
                      <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{prof.specialty.trim()}</span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const errorBlock =
    error != null ? (
      <p className="mt-4 rounded-xl border border-red-800/50 bg-red-950/40 px-4 py-3 text-sm text-red-100">
        {error}
      </p>
    ) : null;

  const footerActions = (compact?: boolean) => (
    <div
      className={`flex flex-wrap gap-3 ${compact ? "justify-end" : "mt-8 justify-end border-t border-[var(--border)] pt-6"}`}
    >
      <button
        type="button"
        onClick={onClose}
        className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-5 py-2.5 text-sm font-medium text-[var(--text-muted)] shadow-sm transition-colors hover:bg-[var(--surface)]"
      >
        {isPanel ? "Voltar ao dashboard" : "Cancelar"}
      </button>
      <button
        type="button"
        disabled={saving || loading || selected.size === 0}
        onClick={() => void handleSave()}
        className="rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95 disabled:opacity-50"
      >
        {saving ? "A guardar…" : "Guardar alterações"}
      </button>
    </div>
  );

  /* ——— Painel admin: página largura total, sem cartão “modal” ——— */
  if (isPanel) {
    return (
      <div
        className="w-full max-w-none text-left"
        role="region"
        aria-labelledby="clinic-agenda-hours-title"
      >
        <header className="mb-6 flex flex-col gap-4 border-b border-[var(--border)] pb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--primary)]">
              Configuração da clínica
            </p>
            <h1
              id="clinic-agenda-hours-title"
              className="font-display mt-2 text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl"
            >
              Configurar horários da clínica
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-relaxed text-[var(--text-muted)]">
              Defina quais blocos de <strong className="font-medium text-[var(--text)]">6h às 22h</strong>{" "}
              aparecem na agenda, calendário e grelhas. Horários desmarcados ficam{" "}
              <strong className="font-medium text-[var(--text)]">ocultos</strong> para todos os médicos e para
              o agente.
            </p>
          </div>
        </header>

        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">A carregar…</p>
        ) : (
          <>
            <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Presets e ações
              </h2>
              {presetToolbar}
            </section>

            <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-[var(--text)]">Grade de horários</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Toque ou clique em cada hora para alternar visibilidade na clínica.
              </p>
              <div className="mt-5">{hourGrid}</div>
              {legend}
            </section>

            {doctorsBlock}
            {errorBlock}
            {footerActions(false)}
          </>
        )}
      </div>
    );
  }

  /* ——— Modal (overlay) ——— */
  const shell = (
    <div
      className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:max-h-[min(90dvh,40rem)] sm:rounded-3xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clinic-agenda-hours-modal-title"
    >
      <header className="shrink-0 border-b border-[var(--border)] px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="clinic-agenda-hours-modal-title"
              className="font-display text-xl font-semibold text-[var(--text)]"
            >
              Configurar horários da clínica
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">
              Escolha quais blocos das <strong className="font-medium">6h às 22h</strong> aparecem na
              agenda e nas grelhas. Horários não marcados ficam{" "}
              <strong className="font-medium">não listados</strong> para todos os médicos e para o
              agente.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface)]"
          >
            Fechar
          </button>
        </div>
      </header>

      <div className="px-6 py-4">
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">A carregar…</p>
        ) : (
          <>
            <div className="mb-4">{presetToolbar}</div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Blocos de 1 hora
            </p>
            {hourGrid}
            {legend}
            <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Médicos do painel
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Usam apenas os horários acima nas vistas da agenda; a disponibilidade por vaga (WhatsApp)
                continua a ajustar-se na grelha por profissional.
              </p>
              {professionals.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--text-muted)]">Nenhum profissional ativo cadastrado.</p>
              ) : (
                <ul className="mt-2 max-h-28 space-y-2 overflow-y-auto text-sm text-[var(--text)]" role="list">
                  {professionals.map((prof) => {
                  const accent = resolveProfessionalCardStyle(null, prof.id).accent;
                  const initials = professionalInitials(prof.name);
                  return (
                    <li key={prof.id} className="list-none flex items-center gap-2 py-0.5">
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ backgroundColor: accent }}
                        aria-hidden
                      >
                        {initials}
                      </span>
                      <span>
                        {prof.name}
                        {prof.specialty?.trim() ? (
                          <span className="text-xs text-[var(--text-muted)]"> · {prof.specialty.trim()}</span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
                </ul>
              )}
            </div>
            {errorBlock}
          </>
        )}
      </div>

      <footer className="shrink-0 border-t border-[var(--border)] px-6 py-4">
        {footerActions(true)}
      </footer>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        aria-label="Fechar"
        onClick={onClose}
      />
      {shell}
    </div>
  );
}
