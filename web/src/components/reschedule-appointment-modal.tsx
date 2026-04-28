"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clinicClosedDayHintPt,
  clinicVisibleHoursForDayKey,
  type ClinicAgendaWeekendConfig,
} from "@/lib/clinic-agenda-hours";
import { localYmdFromIso } from "@/lib/local-day";
import {
  csAgendamentoUuidFromPanelId,
  markSkipDuplicateRescheduleProfNotify,
  painelRpcReagendarCsErrorMessage,
} from "@/lib/painel-notify-professional";
import {
  formatDateBrFromIso,
  formatHoraBrFromIso,
} from "@/lib/professional-notify-message";
import { one, type AppointmentRow } from "@/types/appointments";

const SLOT_MINUTES = 30;

function buildHourlyStarts(clinicVisibleHours: number[]): string[] {
  const h = [...clinicVisibleHours]
    .filter((x) => Number.isFinite(x) && x >= 6 && x <= 22)
    .sort((a, b) => a - b);
  return h.map((x) => `${String(x).padStart(2, "0")}:00`);
}

type RosterEntry = {
  id: string;
  name: string;
  cs_profissional_id: string | null;
  is_active: boolean;
  gender?: string | null;
  whatsapp?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  supabase: SupabaseClient;
  clinicId: string;
  clinicAgendaConfig: ClinicAgendaWeekendConfig;
  appointment: AppointmentRow | null;
  profRoster: RosterEntry[];
  rowBusy: string | null;
  setRowBusy: (id: string | null) => void;
};

export function RescheduleAppointmentModal({
  open,
  onClose,
  onSuccess,
  supabase,
  clinicId,
  clinicAgendaConfig,
  appointment,
  profRoster,
  rowBusy,
  setRowBusy,
}: Props) {
  const [prefDate, setPrefDate] = useState("");
  const [prefTime, setPrefTime] = useState("");
  const [panelProfessionalId, setPanelProfessionalId] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isCs = appointment?.id.startsWith("cs:") ?? false;
  const patientName = one(appointment?.patients ?? null)?.name?.trim() || "Cliente";

  const activeRoster = useMemo(
    () => profRoster.filter((p) => p.is_active !== false),
    [profRoster]
  );

  const hoursForSelectedDate = useMemo(() => {
    if (!prefDate?.trim()) return clinicAgendaConfig.weekdayHours;
    return clinicVisibleHoursForDayKey(prefDate.trim(), clinicAgendaConfig);
  }, [prefDate, clinicAgendaConfig]);

  const closedDayHint = useMemo(() => {
    if (!prefDate?.trim()) return null;
    return clinicClosedDayHintPt(prefDate.trim(), clinicAgendaConfig);
  }, [prefDate, clinicAgendaConfig]);

  const timeOptions = useMemo(
    () => buildHourlyStarts(hoursForSelectedDate),
    [hoursForSelectedDate]
  );

  const resetFromAppointment = useCallback(() => {
    if (!appointment) return;
    setPrefDate(localYmdFromIso(appointment.starts_at));
    const t = new Date(appointment.starts_at);
    const hh = String(t.getHours()).padStart(2, "0");
    setPrefTime(`${hh}:00`);
    const prof = one(appointment.professionals);
    const pid = prof?.id != null && String(prof.id).trim() !== "" ? String(prof.id) : "";
    const withCs = activeRoster.filter((r) => r.cs_profissional_id);
    if (appointment.id.startsWith("cs:")) {
      if (pid && withCs.some((r) => r.id === pid)) {
        setPanelProfessionalId(pid);
      } else {
        const embedName = prof?.name?.trim() ?? "";
        const byName = embedName
          ? withCs.find(
              (r) => r.name.trim().toLowerCase() === embedName.toLowerCase()
            )
          : undefined;
        setPanelProfessionalId(byName?.id ?? withCs[0]?.id ?? "");
      }
    } else {
      setPanelProfessionalId(pid && activeRoster.some((r) => r.id === pid) ? pid : "");
    }
    setSubmitError(null);
  }, [appointment, activeRoster]);

  useEffect(() => {
    if (!open || !appointment) return;
    resetFromAppointment();
  }, [open, appointment, resetFromAppointment]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, submitting]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!appointment) return;
    setSubmitError(null);

    if (!prefDate || !prefTime) {
      setSubmitError("Escolha data e horário.");
      return;
    }
    if (closedDayHint) {
      setSubmitError(closedDayHint);
      return;
    }

    const [hh, mm] = prefTime.split(":").map(Number);
    const newStart = new Date(
      `${prefDate}T${String(hh).padStart(2, "0")}:${String(mm ?? 0).padStart(2, "0")}:00`
    );
    if (Number.isNaN(newStart.getTime())) {
      setSubmitError("Data ou horário inválidos.");
      return;
    }

    const prevStart = new Date(appointment.starts_at).getTime();
    const sameInstant = newStart.getTime() === prevStart;

    if (isCs) {
      const rosterEntry = activeRoster.find((r) => r.id === panelProfessionalId);
      if (!rosterEntry?.cs_profissional_id) {
        setSubmitError(
          "Este profissional não está ligado à agenda do agente (cs). Edite o profissional e associe o ID correto, ou escolha outro."
        );
        return;
      }
      const csUuid = csAgendamentoUuidFromPanelId(appointment.id);
      if (!csUuid) {
        setSubmitError("Identificador de agendamento inválido.");
        return;
      }

      const curProf = one(appointment.professionals);
      const curRosterId =
        curProf?.id && activeRoster.some((r) => r.id === String(curProf.id))
          ? String(curProf.id)
          : null;
      const sameProf = !curRosterId || curRosterId === panelProfessionalId;

      if (sameInstant && sameProf) {
        setSubmitError("Altere a data, o horário ou o profissional para reagendar.");
        return;
      }

      setSubmitting(true);
      setRowBusy(appointment.id);
      const timeStr = `${String(hh).padStart(2, "0")}:${String(mm ?? 0).padStart(2, "0")}:00`;

      const { data, error } = await supabase.rpc("painel_reagendar_cs_agendamento", {
        p_clinic_id: clinicId,
        p_cs_agendamento_id: csUuid,
        p_nova_data: prefDate,
        p_novo_cs_profissional_id: rosterEntry.cs_profissional_id,
        p_novo_horario: timeStr,
      });

      setSubmitting(false);
      setRowBusy(null);

      if (error) {
        setSubmitError(
          error.message +
            (error.message.includes("permission") || error.code === "42501"
              ? " — Execute as migrações do painel no Supabase (painel_reagendar_cs_agendamento)."
              : "")
        );
        return;
      }

      const rpcErr = painelRpcReagendarCsErrorMessage(data);
      if (rpcErr) {
        setSubmitError(rpcErr);
        return;
      }

      const pat = one(appointment.patients);
      try {
        const res = await fetch("/api/whatsapp/notify-panel-reschedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: clinicId,
            patient_name: pat?.name ?? "Cliente",
            patient_phone: pat?.phone ?? "",
            professional_name: rosterEntry.name,
            professional_gender: rosterEntry.gender ?? null,
            professional_phone: rosterEntry.whatsapp ?? null,
            servico: (appointment.service_name || "Consulta").trim(),
            data_anterior: formatDateBrFromIso(appointment.starts_at),
            hora_anterior: formatHoraBrFromIso(appointment.starts_at),
            nova_data: formatDateBrFromIso(newStart.toISOString()),
            novo_horario: formatHoraBrFromIso(newStart.toISOString()),
          }),
        });
        if (res.ok) {
          const j = (await res.json().catch(() => ({}))) as {
            notified_professional?: boolean;
            notified_patient?: boolean;
          };
          if (!j.notified_professional && !j.notified_patient) {
            /* Evolution/números: falha silenciosa; evita bloquear o fluxo */
          }
        }
      } catch {
        /* rede */
      }

      onSuccess();
      onClose();
      return;
    }

    /* appointments nativos do painel */
    if (sameInstant) {
      setSubmitError("Altere a data ou o horário para reagendar.");
      return;
    }

    const dur =
      new Date(appointment.ends_at).getTime() -
      new Date(appointment.starts_at).getTime();
    const newEnd = new Date(newStart.getTime() + Math.max(dur, SLOT_MINUTES * 60 * 1000));

    setSubmitting(true);
    setRowBusy(appointment.id);

    const { error } = await supabase
      .from("appointments")
      .update({
        starts_at: newStart.toISOString(),
        ends_at: newEnd.toISOString(),
      })
      .eq("id", appointment.id);

    setSubmitting(false);
    setRowBusy(null);

    if (error) {
      if (error.message.includes("overlap") || error.code === "23P01") {
        setSubmitError(
          "Este horário choca com outra marcação do mesmo profissional. Escolha outro horário."
        );
      } else {
        setSubmitError(
          error.message +
            (error.message.includes("permission") || error.code === "42501"
              ? " — Verifique as políticas RLS de appointments."
              : "")
        );
      }
      return;
    }

    const pat = one(appointment.patients);
    const prof = one(appointment.professionals);
    const profEntry =
      prof?.id != null
        ? activeRoster.find((r) => r.id === String(prof.id))
        : undefined;
    try {
      const res = await fetch("/api/whatsapp/notify-panel-reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_name: pat?.name ?? "Cliente",
          patient_phone: pat?.phone ?? "",
          professional_name: prof?.name ?? "",
          professional_gender: profEntry?.gender ?? prof?.gender ?? null,
          professional_phone: profEntry?.whatsapp ?? null,
          servico: (appointment.service_name || "Consulta").trim(),
          data_anterior: formatDateBrFromIso(appointment.starts_at),
          hora_anterior: formatHoraBrFromIso(appointment.starts_at),
          nova_data: formatDateBrFromIso(newStart.toISOString()),
          novo_horario: formatHoraBrFromIso(newStart.toISOString()),
        }),
      });
      if (res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          notified_professional?: boolean;
        };
        if (j.notified_professional) {
          markSkipDuplicateRescheduleProfNotify(appointment.id);
        }
      }
    } catch {
      /* falha de rede: o painel já gravou o horário */
    }

    onSuccess();
    onClose();
  }

  if (!open || !appointment) return null;

  const busy = rowBusy === appointment.id;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reschedule-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        aria-label="Fechar"
        disabled={submitting}
        onClick={() => !submitting && onClose()}
      />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] shadow-xl">
        <div className="border-b border-[var(--border)] bg-[var(--primary)]/15 px-5 py-4">
          <h2
            id="reschedule-modal-title"
            className="font-display text-lg font-semibold text-[var(--text)]"
          >
            Alterar horário
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {patientName}
            {isCs ? " · agenda do agente (WhatsApp/IA)" : " · marcação no painel"}
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-5 py-5">
          {isCs ? (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Profissional
              </span>
              <select
                value={panelProfessionalId}
                onChange={(e) => setPanelProfessionalId(e.target.value)}
                required
                disabled={busy}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
              >
                {activeRoster.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {!p.cs_profissional_id ? " (sem ligação cs)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Nova data
              </span>
              <input
                type="date"
                value={prefDate}
                onChange={(e) => setPrefDate(e.target.value)}
                required
                disabled={busy}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Novo horário
              </span>
              <select
                value={prefTime}
                onChange={(e) => setPrefTime(e.target.value)}
                required
                disabled={busy}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
              >
                <option value="">Horário</option>
                {timeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {closedDayHint ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {closedDayHint}
            </p>
          ) : null}

          {submitError ? (
            <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger-text)]">
              {submitError}
            </p>
          ) : null}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => !submitting && onClose()}
              disabled={busy}
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || !!closedDayHint}
              className="flex-1 rounded-xl bg-[var(--primary)] py-2.5 text-sm font-semibold text-white hover:bg-[var(--primary-strong)] disabled:opacity-50"
            >
              {busy ? "A guardar…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
