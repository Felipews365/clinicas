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
  "flex min-h-[3.25rem] items-center justify-center rounded-xl border border-[#b8d9cf] bg-[#e8f5f1] px-3 py-3 text-sm font-semibold tabular-nums text-[#0f4c44] shadow-sm transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-md";
const hourBtnOff =
  "flex min-h-[3.25rem] items-center justify-center rounded-xl border border-dashed border-[#c4bfb5] bg-[#f4f2ee] px-3 py-3 text-sm font-semibold tabular-nums text-[#78716b] line-through decoration-[#a8a29e] decoration-2 transition-colors hover:bg-[#ece8e0]";

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
        className="rounded-xl border border-[#c5ddd4] bg-[#f0faf6] px-4 py-2.5 text-xs font-semibold text-[#1e4d40] shadow-sm transition-colors hover:bg-[#e2f5ec]"
      >
        Tudo 6h–22h
      </button>
      <button
        type="button"
        onClick={() => selectCommercialHours()}
        className="rounded-xl border border-[#e4c9a8] bg-[#fff6eb] px-4 py-2.5 text-xs font-semibold text-[#8b4e12] shadow-sm transition-colors hover:bg-[#ffefd9]"
      >
        Horário comercial (8h–11h, 14h–17h)
      </button>
    </div>
  );

  const hourGrid = (
    <div
      className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]"
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
    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[#5c5348]">
      <span className="inline-flex items-center gap-2">
        <span className="h-4 w-6 shrink-0 rounded-lg border border-[#b8d9cf] bg-[#e8f5f1]" aria-hidden />
        Na agenda e grelhas
      </span>
      <span className="inline-flex items-center gap-2">
        <span
          className="h-4 w-6 shrink-0 rounded-lg border border-dashed border-[#c4bfb5] bg-[#f4f2ee]"
          aria-hidden
        />
        Não listado
      </span>
    </div>
  );

  const doctorsBlock = (
    <section className="rounded-[18px] border border-[#dfe8e5] bg-white/95 p-5 shadow-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#6b8f89]">
        Médicos ativos no painel
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-[#6b635a]">
        Usam apenas os horários selecionados acima nas vistas da agenda. A disponibilidade por vaga
        (WhatsApp) ajusta-se na grelha por profissional.
      </p>
      {professionals.length === 0 ? (
        <p className="mt-4 text-sm text-[#9a9288]">Nenhum profissional ativo cadastrado.</p>
      ) : (
        <ul
          className="mt-4 grid gap-2 text-sm text-[#2c2825] sm:grid-cols-2 lg:grid-cols-3"
          role="list"
        >
          {professionals.map((p) => (
            <li
              key={p.id}
              className="list-none rounded-xl border border-[#ebe6dd] bg-[#faf8f5] px-3 py-2.5"
            >
              <span className="font-medium">{p.name}</span>
              {p.specialty?.trim() ? (
                <span className="mt-0.5 block text-xs text-[#8a8278]">{p.specialty.trim()}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const errorBlock =
    error != null ? (
      <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        {error}
      </p>
    ) : null;

  const footerActions = (compact?: boolean) => (
    <div
      className={`flex flex-wrap gap-3 ${compact ? "justify-end" : "mt-8 justify-end border-t border-[#d0dedb] pt-6"}`}
    >
      <button
        type="button"
        onClick={onClose}
        className="rounded-xl border border-[#dcd5ca] bg-white px-5 py-2.5 text-sm font-medium text-[#5c5348] shadow-sm transition-colors hover:bg-[#f7f4ef]"
      >
        {isPanel ? "Voltar ao dashboard" : "Cancelar"}
      </button>
      <button
        type="button"
        disabled={saving || loading || selected.size === 0}
        onClick={() => void handleSave()}
        className="rounded-xl bg-[#0f766e] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0d6560] disabled:opacity-50"
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
        <header className="mb-6 flex flex-col gap-4 border-b border-[#c5d9d4] pb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#0f766e]">
              Configuração da clínica
            </p>
            <h1
              id="clinic-agenda-hours-title"
              className="font-display mt-2 text-2xl font-semibold tracking-tight text-[#0f2d28] sm:text-3xl"
            >
              Configurar horários da clínica
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-relaxed text-[#5c5348]">
              Defina quais blocos de <strong className="font-medium text-[#2c2825]">6h às 22h</strong>{" "}
              aparecem na agenda, calendário e grelhas. Horários desmarcados ficam{" "}
              <strong className="font-medium text-[#2c2825]">ocultos</strong> para todos os médicos e para
              o agente.
            </p>
          </div>
        </header>

        {loading ? (
          <p className="text-sm text-[#7a7268]">A carregar…</p>
        ) : (
          <>
            <section className="mb-6 rounded-[18px] border border-[#dfe8e5] bg-white/95 p-6 shadow-sm">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#6b8f89]">
                Presets e ações
              </h2>
              {presetToolbar}
            </section>

            <section className="mb-6 rounded-[18px] border border-[#dfe8e5] bg-[#fffdf9] p-6 shadow-sm">
              <h2 className="text-sm font-semibold text-[#2c2825]">Grade de horários</h2>
              <p className="mt-1 text-xs text-[#7a7268]">
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
      className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl border border-[#e8e2d9] bg-[#fffdf9] shadow-2xl sm:max-h-[min(90dvh,40rem)] sm:rounded-3xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clinic-agenda-hours-modal-title"
    >
      <header className="shrink-0 border-b border-[#ebe6dd] px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="clinic-agenda-hours-modal-title"
              className="font-display text-xl font-semibold text-[#1f1c1a]"
            >
              Configurar horários da clínica
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[#6b635a]">
              Escolha quais blocos das <strong className="font-medium">6h às 22h</strong> aparecem na
              agenda e nas grelhas. Horários não marcados ficam{" "}
              <strong className="font-medium">não listados</strong> para todos os médicos e para o
              agente.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl border border-[#dcd5ca] bg-white px-3 py-2 text-sm font-medium text-[#5c5348] hover:bg-[#f7f4ef]"
          >
            Fechar
          </button>
        </div>
      </header>

      <div className="px-6 py-4">
        {loading ? (
          <p className="text-sm text-[#7a7268]">A carregar…</p>
        ) : (
          <>
            <div className="mb-4">{presetToolbar}</div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#8a8278]">
              Blocos de 1 hora
            </p>
            {hourGrid}
            {legend}
            <div className="mt-6 rounded-xl border border-[#ebe6dd] bg-[#faf8f5] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8278]">
                Médicos do painel
              </p>
              <p className="mt-1 text-xs text-[#6b635a]">
                Usam apenas os horários acima nas vistas da agenda; a disponibilidade por vaga (WhatsApp)
                continua a ajustar-se na grelha por profissional.
              </p>
              {professionals.length === 0 ? (
                <p className="mt-2 text-sm text-[#9a9288]">Nenhum profissional ativo cadastrado.</p>
              ) : (
                <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-sm text-[#2c2825]" role="list">
                  {professionals.map((p) => (
                    <li key={p.id} className="list-none">
                      {p.name}
                      {p.specialty?.trim() ? (
                        <span className="text-xs text-[#8a8278]"> · {p.specialty.trim()}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {errorBlock}
          </>
        )}
      </div>

      <footer className="shrink-0 border-t border-[#ebe6dd] px-6 py-4">
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
        className="absolute inset-0 bg-[#1c1917]/45 backdrop-blur-[2px]"
        aria-label="Fechar"
        onClick={onClose}
      />
      {shell}
    </div>
  );
}
