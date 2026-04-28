"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clinicClosedDayHintPt,
  clinicVisibleHoursForDayKey,
  type ClinicAgendaWeekendConfig,
} from "@/lib/clinic-agenda-hours";
import {
  normalizeProfissionalGenero,
  profWhatsAppNovoAgendamento,
} from "@/lib/professional-notify-message";
import { withProfessionalsGenderFallback } from "@/lib/supabase-gender-column-fallback";

const CONSULTATION_TYPES = [
  "Consulta Inicial",
  "Retorno",
  "Exame",
  "Procedimento",
] as const;

const SLOT_MINUTES = 30;

function digitsOnly(phone: string) {
  return phone.replace(/\D/g, "");
}

/** Inícios à hora cheia, alinhados à configuração global da clínica (6h–22h). */
function buildHourlyStarts(clinicVisibleHours: number[]): string[] {
  const h = [...clinicVisibleHours]
    .filter((x) => Number.isFinite(x) && x >= 6 && x <= 22)
    .sort((a, b) => a - b);
  return h.map((x) => `${String(x).padStart(2, "0")}:00`);
}

type Prof = {
  id: string;
  name: string;
  specialty: string | null;
  whatsapp: string | null;
  gender?: string | null;
};

type ClinicProcedure = {
  id: string;
  name: string;
  duration_minutes: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  supabase: SupabaseClient;
  clinicId: string;
  clinicAgendaConfig: ClinicAgendaWeekendConfig;
};

function profLabel(p: Prof) {
  return p.specialty ? `${p.name} · ${p.specialty}` : p.name;
}

export function ScheduleAppointmentModal({
  open,
  onClose,
  onSuccess,
  supabase,
  clinicId,
  clinicAgendaConfig,
}: Props) {
  const [professionals, setProfessionals] = useState<Prof[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [prefDate, setPrefDate] = useState("");
  const [prefTime, setPrefTime] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  /** Quando há catálogo `clinic_procedures`, guarda o id do procedimento. */
  const [consultProcedureId, setConsultProcedureId] = useState("");
  /** Sem catálogo, usa tipos genéricos. */
  const [consultLegacyType, setConsultLegacyType] = useState("");
  const [notes, setNotes] = useState("");

  const [procedureCatalog, setProcedureCatalog] = useState<ClinicProcedure[]>(
    [],
  );
  const [profProcedureIds, setProfProcedureIds] = useState<
    Map<string, Set<string>>
  >(() => new Map());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hoursForSelectedDate = useMemo(() => {
    if (!prefDate?.trim()) {
      return clinicAgendaConfig.weekdayHours;
    }
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

  const resetForm = useCallback(() => {
    setFullName("");
    setPhone("");
    setPrefDate("");
    setPrefTime("");
    setProfessionalId("");
    setConsultProcedureId("");
    setConsultLegacyType("");
    setNotes("");
    setSubmitError(null);
  }, []);

  /** Profissionais que realizam o procedimento selecionado (vazio em professional_procedures = todos). */
  const professionalsEligibleForConsult = useMemo(() => {
    if (procedureCatalog.length === 0 || !consultProcedureId) return professionals;
    return professionals.filter((p) => {
      const allowed = profProcedureIds.get(p.id);
      if (!allowed || allowed.size === 0) return true;
      return allowed.has(consultProcedureId);
    });
  }, [professionals, consultProcedureId, procedureCatalog.length, profProcedureIds]);

  const loadProfessionals = useCallback(async () => {
    setLoadingMeta(true);
    setLoadError(null);
    const { data: pros, error: pErr } = await withProfessionalsGenderFallback(
      (includeGender) =>
        supabase
          .from("professionals")
          .select(
            includeGender
              ? "id, name, specialty, whatsapp, gender"
              : "id, name, specialty, whatsapp"
          )
          .eq("clinic_id", clinicId)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true })
    );

    if (pErr) {
      setLoadingMeta(false);
      setLoadError(pErr.message);
      setProfessionals([]);
      setProcedureCatalog([]);
      setProfProcedureIds(new Map());
      return;
    }
    const list = (pros ?? []) as Prof[];
    setProfessionals(list);

    const proIds = list.map((p) => p.id);
    const [procsRes, linksRes] = await Promise.all([
      supabase
        .from("clinic_procedures")
        .select("id, name, duration_minutes")
        .eq("clinic_id", clinicId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      proIds.length
        ? supabase
            .from("professional_procedures")
            .select("professional_id, clinic_procedure_id")
            .in("professional_id", proIds)
        : Promise.resolve({ data: null as null, error: null as null }),
    ]);

    setLoadingMeta(false);

    if (procsRes.error) {
      setProcedureCatalog([]);
    } else {
      setProcedureCatalog((procsRes.data ?? []) as ClinicProcedure[]);
    }

    const linkMap = new Map<string, Set<string>>();
    if (!linksRes.error && linksRes.data) {
      for (const row of linksRes.data as {
        professional_id: string;
        clinic_procedure_id: string;
      }[]) {
        const pid = row.professional_id;
        const cid = row.clinic_procedure_id;
        if (!linkMap.has(pid)) linkMap.set(pid, new Set());
        linkMap.get(pid)!.add(cid);
      }
    }
    setProfProcedureIds(linkMap);

    if (!list.length) {
      setLoadError(
        "Não há profissionais ativos. Abra «Profissionais» no painel e cadastre pelo menos um."
      );
    }
  }, [supabase, clinicId]);

  /* eslint-disable react-hooks/set-state-in-effect -- ao abrir: recarregar lista e limpar campos */
  useEffect(() => {
    if (!open) return;
    void loadProfessionals();
    resetForm();
  }, [open, loadProfessionals, resetForm]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const name = fullName.trim();
    const phoneDigits = digitsOnly(phone);
    if (!name || phoneDigits.length < 10) {
      setSubmitError("Preencha nome e um telefone válido (mín. 10 dígitos).");
      return;
    }
    if (!prefDate || !prefTime) {
      setSubmitError("Escolha data e horário.");
      return;
    }
    const useCatalog = procedureCatalog.length > 0;
    if (!professionalId) {
      setSubmitError("Selecione o profissional.");
      return;
    }
    if (useCatalog) {
      if (!consultProcedureId) {
        setSubmitError("Selecione o tipo de consulta (procedimento).");
        return;
      }
      if (
        !professionalsEligibleForConsult.some((p) => p.id === professionalId)
      ) {
        setSubmitError(
          "Este profissional não está associado a este procedimento. Ajuste em «Profissionais» ou escolha outro profissional."
        );
        return;
      }
    } else if (!consultLegacyType) {
      setSubmitError("Selecione o tipo de consulta.");
      return;
    }

    const [hh, mm] = prefTime.split(":").map(Number);
    const starts = new Date(
      `${prefDate}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`
    );
    if (Number.isNaN(starts.getTime())) {
      setSubmitError("Data ou horário inválidos.");
      return;
    }

    let serviceName: string;
    let slotMinutes = SLOT_MINUTES;
    if (useCatalog) {
      const proc = procedureCatalog.find((x) => x.id === consultProcedureId);
      if (!proc) {
        setSubmitError("Procedimento inválido.");
        return;
      }
      serviceName = proc.name;
      const d = Number(proc.duration_minutes);
      if (Number.isFinite(d) && d > 0) slotMinutes = d;
    } else {
      serviceName = consultLegacyType;
    }

    const ends = new Date(starts.getTime() + slotMinutes * 60 * 1000);

    setSubmitting(true);

    const phoneStored =
      phoneDigits.length >= 10 && !phone.trim().startsWith("+")
        ? `+55${phoneDigits.replace(/^0+/, "")}`
        : phone.trim() || `+${phoneDigits}`;

    const { data: existing, error: findErr } = await supabase
      .from("patients")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("phone", phoneStored)
      .maybeSingle();

    if (findErr) {
      setSubmitting(false);
      setSubmitError(findErr.message);
      return;
    }

    let patientId = existing?.id as string | undefined;

    if (patientId) {
      const { error: upErr } = await supabase
        .from("patients")
        .update({ name })
        .eq("id", patientId);
      if (upErr) {
        setSubmitting(false);
        setSubmitError(upErr.message);
        return;
      }
    } else {
      const { data: ins, error: insErr } = await supabase
        .from("patients")
        .insert({
          clinic_id: clinicId,
          phone: phoneStored,
          name,
        })
        .select("id")
        .single();

      if (insErr || !ins?.id) {
        setSubmitting(false);
        setSubmitError(
          insErr?.message ??
            "Não foi possível criar o paciente. Execute supabase/rls_owner_agendar_painel.sql no Supabase."
        );
        return;
      }
      patientId = ins.id as string;
    }

    const { error: apErr } = await supabase.from("appointments").insert({
      clinic_id: clinicId,
      professional_id: professionalId,
      patient_id: patientId,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      service_name: serviceName,
      status: "scheduled",
      source: "painel",
      notes: notes.trim() || null,
    });

    setSubmitting(false);

    if (apErr) {
      if (apErr.message.includes("overlap") || apErr.code === "23P01") {
        setSubmitError(
          "Este horário já está ocupado para este profissional. Outro profissional pode marcar ao mesmo tempo; escolha outro horário ou outro profissional."
        );
      } else {
        setSubmitError(
          apErr.message +
            (apErr.message.includes("permission") || apErr.code === "42501"
              ? " — Execute no Supabase o ficheiro supabase/rls_owner_agendar_painel.sql."
              : "")
        );
      }
      return;
    }

    // Notificar profissional via WhatsApp (fire-and-forget)
    const prof = professionals.find((p) => p.id === professionalId);
    if (prof?.whatsapp?.trim()) {
      const [y, m, d] = prefDate.split("-");
      const dataFmt = `${d}/${m}/${y}`;
      const text = profWhatsAppNovoAgendamento({
        profissional: prof.name?.trim() || null,
        profissionalGenero: normalizeProfissionalGenero(prof.gender),
        cliente: fullName.trim(),
        clienteTelefone: phoneStored,
        servico: serviceName,
        data: dataFmt,
        hora: prefTime,
      });
      void fetch("/api/whatsapp/notify-professional", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_id: clinicId, phone: prof.whatsapp.trim(), text }),
      }).catch(() => {});
    }

    resetForm();
    onSuccess();
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        aria-label="Fechar"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-[#e8e4dc] bg-[#faf8f4] shadow-xl">
        <div className="bg-[#4D6D66] px-6 py-5 text-white">
          <h2
            id="schedule-modal-title"
            className="font-display text-2xl font-semibold tracking-tight"
          >
            Agendar consulta
          </h2>
          <p className="mt-1 text-sm text-white/85">
            {procedureCatalog.length > 0
              ? "Primeiro o procedimento — só aparecem profissionais que o realizam."
              : "Escolha o profissional certo — vários podem atender à mesma hora."}
          </p>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-5 bg-white px-6 py-6"
        >
          {loadingMeta ? (
            <p className="text-sm text-[#6b635a]">A carregar profissionais…</p>
          ) : loadError && !professionals.length ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {loadError}
            </p>
          ) : null}

          {procedureCatalog.length > 0 ? (
            <>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
                  Tipo de consulta
                </span>
                <select
                  required
                  value={consultProcedureId}
                  onChange={(e) => {
                    setConsultProcedureId(e.target.value);
                    setProfessionalId("");
                  }}
                  className="w-full rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
                >
                  <option value="">Selecione o procedimento</option>
                  {procedureCatalog.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-[#6b635a]">
                  Só aparecem profissionais que realizam este procedimento (configurado em «Profissionais»).
                </p>
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
                  Profissional
                </span>
                <select
                  required
                  value={professionalId}
                  onChange={(e) => setProfessionalId(e.target.value)}
                  disabled={!consultProcedureId}
                  className="w-full rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">
                    {!consultProcedureId
                      ? "Selecione o tipo de consulta primeiro"
                      : professionalsEligibleForConsult.length === 0
                        ? "Nenhum profissional faz este procedimento — ajuste o cadastro"
                        : "Selecione quem atende"}
                  </option>
                  {professionalsEligibleForConsult.map((p) => (
                    <option key={p.id} value={p.id}>
                      {profLabel(p)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
                Profissional
              </span>
              <select
                required
                value={professionalId}
                onChange={(e) => {
                  setProfessionalId(e.target.value);
                  setConsultProcedureId("");
                  setConsultLegacyType("");
                }}
                className="w-full rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
              >
                <option value="">Selecione quem atende</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {profLabel(p)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
                Nome completo
              </span>
              <input
                required
                autoComplete="name"
                placeholder="João Silva"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
                Telefone / WhatsApp
              </span>
              <input
                required
                type="tel"
                autoComplete="tel"
                placeholder="(81) 99999-9999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
                Data
              </span>
              <input
                required
                type="date"
                value={prefDate}
                onChange={(e) => setPrefDate(e.target.value)}
                onClick={(e) => {
                  const el = e.currentTarget as HTMLInputElement & {
                    showPicker?: () => void;
                  };
                  if (typeof el.showPicker === "function") {
                    try {
                      el.showPicker();
                    } catch {
                      /* alguns browsers bloqueiam fora de gesto do utilizador */
                    }
                  }
                }}
                className="w-full cursor-pointer rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
              />
              {closedDayHint ? (
                <p className="mt-1.5 text-xs font-medium text-amber-800">{closedDayHint}</p>
              ) : null}
              {prefDate && !closedDayHint && timeOptions.length === 0 ? (
                <p className="mt-1.5 text-xs text-[#6b635a]">
                  Não há blocos configurados para esta data. Ajuste «Configurar horários da clínica».
                </p>
              ) : null}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
                Horário
              </span>
              <select
                required
                value={prefTime}
                onChange={(e) => setPrefTime(e.target.value)}
                disabled={timeOptions.length === 0}
                className="w-full rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {timeOptions.length === 0 ? "—" : "Selecione"}
                </option>
                {timeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {procedureCatalog.length === 0 ? (
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
                  Tipo de consulta
                </span>
                <select
                  required
                  value={consultLegacyType}
                  onChange={(e) => setConsultLegacyType(e.target.value)}
                  disabled={!professionalId}
                  className="w-full rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">
                    {!professionalId
                      ? "Selecione o profissional primeiro"
                      : "Selecione"}
                  </option>
                  {CONSULTATION_TYPES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
              Observações (opcional)
            </span>
            <textarea
              rows={3}
              placeholder="Descreva brevemente o motivo da consulta…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full resize-y rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
            />
          </label>

          {submitError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {submitError}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-[#d4cfc4] px-5 py-3 text-sm font-semibold text-[#4a453d] hover:bg-[#f5f1eb]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={
                submitting || loadingMeta || !professionals.length
              }
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#4D6D66] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#3f5c56] disabled:opacity-50 sm:w-auto"
            >
              <span aria-hidden>✓</span>
              {submitting ? "A enviar…" : "Enviar agendamento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
