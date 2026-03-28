"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

const CONSULTATION_TYPES = [
  "Consulta Inicial",
  "Retorno",
  "Exame",
  "Procedimento",
] as const;

const SLOT_MINUTES = 30;
const WORK_START = 8;
const WORK_END = 18;

function digitsOnly(phone: string) {
  return phone.replace(/\D/g, "");
}

function buildTimeOptions(): string[] {
  const out: string[] = [];
  for (let h = WORK_START; h < WORK_END; h++) {
    for (const m of [0, 30]) {
      if (h === WORK_END - 1 && m === 30) break;
      out.push(`${String(h).padStart(2, "0")}:${m === 0 ? "00" : "30"}`);
    }
  }
  return out;
}

type Prof = { id: string; name: string; specialty: string | null };

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  supabase: SupabaseClient;
  clinicId: string;
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
}: Props) {
  const [professionals, setProfessionals] = useState<Prof[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [prefDate, setPrefDate] = useState("");
  const [prefTime, setPrefTime] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [consultType, setConsultType] = useState<string>("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const timeOptions = useMemo(() => buildTimeOptions(), []);

  const resetForm = useCallback(() => {
    setFullName("");
    setPhone("");
    setPrefDate("");
    setPrefTime("");
    setProfessionalId("");
    setConsultType("");
    setNotes("");
    setSubmitError(null);
  }, []);

  const loadProfessionals = useCallback(async () => {
    setLoadingMeta(true);
    setLoadError(null);
    const { data: pros, error: pErr } = await supabase
      .from("professionals")
      .select("id, name, specialty")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    setLoadingMeta(false);
    if (pErr) {
      setLoadError(pErr.message);
      setProfessionals([]);
      return;
    }
    const list = (pros ?? []) as Prof[];
    setProfessionals(list);
    if (!list.length) {
      setLoadError(
        "Não há profissionais ativos. Abra «Profissionais» no painel e cadastre pelo menos um."
      );
    }
  }, [supabase, clinicId]);

  useEffect(() => {
    if (!open) return;
    void loadProfessionals();
    resetForm();
  }, [open, loadProfessionals, resetForm]);

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
    if (!professionalId || !consultType) {
      setSubmitError("Selecione o profissional e o tipo de consulta.");
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
    const ends = new Date(starts.getTime() + SLOT_MINUTES * 60 * 1000);

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
      service_name: consultType,
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
            Escolha o profissional certo — vários podem atender à mesma hora.
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

          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
              Profissional
            </span>
            <select
              required
              value={professionalId}
              onChange={(e) => setProfessionalId(e.target.value)}
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
                className="w-full rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
                Horário
              </span>
              <select
                required
                value={prefTime}
                onChange={(e) => setPrefTime(e.target.value)}
                className="w-full rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
              >
                <option value="">Selecione</option>
                {timeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#6b635a]">
                Tipo de consulta
              </span>
              <select
                required
                value={consultType}
                onChange={(e) => setConsultType(e.target.value)}
                className="w-full rounded-lg border border-[#d4cfc4] bg-[#faf8f4] px-3 py-2.5 text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
              >
                <option value="">Selecione</option>
                {CONSULTATION_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
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
