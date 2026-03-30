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
};

export function ClinicAgendaHoursModal({
  open,
  onClose,
  supabase,
  clinicId,
  onSaved,
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
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clinic-agenda-hours-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[#1c1917]/45 backdrop-blur-[2px]"
        aria-label="Fechar"
        onClick={onClose}
      />
      <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-y-auto rounded-t-3xl border border-[#e8e2d9] bg-[#fffdf9] shadow-2xl sm:max-h-[min(90dvh,40rem)] sm:rounded-3xl">
        <header className="shrink-0 border-b border-[#ebe6dd] px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="clinic-agenda-hours-title"
                className="font-display text-xl font-semibold text-[#1f1c1a]"
              >
                Configurar horários da clínica
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-[#6b635a]">
                Escolha quais blocos das <strong className="font-medium">6h às 22h</strong> aparecem na
                agenda e nas grelhas. Horários não marcados ficam <strong className="font-medium">não listados</strong>{" "}
                para todos os médicos e para o agente.
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
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => selectAllDay()}
                  className="rounded-lg border border-[#c5ddd4] bg-[#f0faf6] px-3 py-1.5 text-xs font-semibold text-[#1e4d40] hover:bg-[#e2f5ec]"
                >
                  Tudo 6h–22h
                </button>
                <button
                  type="button"
                  onClick={() => selectCommercialHours()}
                  className="rounded-lg border border-[#e4c9a8] bg-[#fff6eb] px-3 py-1.5 text-xs font-semibold text-[#8b4e12] hover:bg-[#ffefd9]"
                >
                  Horário comercial (8h–11h, 14h–17h)
                </button>
              </div>

              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#8a8278]">
                Blocos de 1 hora
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {FULL_CLINIC_AGENDA_HOURS.map((h) => {
                  const on = selected.has(h);
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => toggleHour(h)}
                      aria-pressed={on}
                      className={
                        on
                          ? "rounded-xl border border-[#c5ddd4] bg-[#f0faf6] py-3 text-sm font-semibold tabular-nums text-[#0f4c44] shadow-sm transition-transform hover:-translate-y-px"
                          : "rounded-xl border border-dashed border-[#c4bfb5] bg-[#f4f2ee] py-3 text-sm font-semibold tabular-nums text-[#78716b] line-through decoration-[#a8a29e] decoration-2"
                      }
                    >
                      {formatAgendaHourLabel(h)}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-[#5c5348]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3.5 w-5 rounded border border-[#c5ddd4] bg-[#f0faf6]" aria-hidden />
                  Na agenda
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-3.5 w-5 rounded border border-dashed border-[#c4bfb5] bg-[#f4f2ee]"
                    aria-hidden
                  />
                  Não listado
                </span>
              </div>

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

              {error ? (
                <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </div>

        <footer className="shrink-0 border-t border-[#ebe6dd] px-6 py-4">
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[#dcd5ca] bg-white px-4 py-2.5 text-sm font-medium text-[#5c5348] hover:bg-[#f7f4ef]"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || loading || selected.size === 0}
              onClick={() => void handleSave()}
              className="rounded-xl bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0d6560] disabled:opacity-50"
            >
              {saving ? "A guardar…" : "Guardar"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
