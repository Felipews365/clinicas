"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AppointmentCardList } from "@/components/appointment-card-list";
import { AppointmentsCalendar } from "@/components/appointments-calendar";
import { ProfessionalsManagerModal } from "@/components/professionals-manager-modal";
import { ScheduleAppointmentModal } from "@/components/schedule-appointment-modal";
import { SlotsManagerModal } from "@/components/slots-manager-modal";
import { WhatsappHumanModal } from "@/components/whatsapp-human-modal";
import {
  addDaysToYmd,
  formatLocalYmd,
  isYmdToday,
  matchesLocalDayKey,
  parseLocalYmd,
} from "@/lib/local-day";
import { createClient } from "@/lib/supabase/client";
import {
  awaitsConfirmation,
  isClinicConfirmed,
  type AppointmentRow,
} from "@/types/appointments";

function parseCsPainelRows(raw: unknown): AppointmentRow[] {
  if (raw == null) return [];
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v as AppointmentRow[];
}

type AccessState =
  | { kind: "loading" }
  | { kind: "denied"; message: string }
  | { kind: "onboarding" }
  | { kind: "clinic"; clinicId: string; clinicName: string | null };

function IconPlus({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function AgendaListSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      aria-busy="true"
      aria-live="polite"
    >
      <p className="sr-only">A carregar a lista de agendamentos</p>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="agenda-animate-in rounded-[1.35rem] border border-[#e8e2d9] bg-white/90 p-6 shadow-sm"
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <div className="flex gap-5">
            <div className="agenda-skeleton h-14 w-14 shrink-0 rounded-2xl" />
            <div className="flex flex-1 flex-col gap-3">
              <div className="agenda-skeleton h-7 max-w-[220px] rounded-lg" />
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="agenda-skeleton h-[4.25rem] rounded-xl" />
                <div className="agenda-skeleton h-[4.25rem] rounded-xl" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgendaPortal() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [clientSynced, setClientSynced] = useState(false);

  const [rows, setRows] = useState<AppointmentRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listFilter, setListFilter] = useState<"all" | "pending" | "confirmed">(
    "all"
  );
  const [viewMode, setViewMode] = useState<"calendar" | "list">("list");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [professionalsOpen, setProfessionalsOpen] = useState(false);
  const [whatsappHumanOpen, setWhatsappHumanOpen] = useState(false);
  const [slotsManagerOpen, setSlotsManagerOpen] = useState(false);
  const [humanQueueCount, setHumanQueueCount] = useState(0);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessState | null>(null);
  /** Vazio até ao mount no cliente — evita hidratação (data UTC vs fuso local). */
  const [dayKey, setDayKey] = useState("");
  const [todayLabel, setTodayLabel] = useState("");

  useEffect(() => {
    const now = new Date();
    setDayKey(formatLocalYmd(now));
    setTodayLabel(
      new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(now)
    );
  }, []);

  useEffect(() => {
    if (!supabase) {
      setClientSynced(true);
      return;
    }
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setClientSynced(true);
    });
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (access?.kind !== "onboarding" || !supabase) return;
    router.replace("/cadastro");
  }, [access?.kind, supabase, router]);

  const loadAppointments = useCallback(async () => {
    if (!supabase) return;
    if (access?.kind !== "clinic") return;
    const clinicId = access.clinicId;
    setListLoading(true);
    setListError(null);

    const { data, error } = await supabase
      .from("appointments")
      .select(
        `
        id,
        starts_at,
        ends_at,
        service_name,
        status,
        source,
        notes,
        patients ( name, phone ),
        professionals ( name, specialty )
      `
      )
      .eq("clinic_id", clinicId)
      .order("starts_at", { ascending: true });

    const { data: csRaw, error: csErr } = await supabase.rpc(
      "painel_list_cs_agendamentos",
      { p_clinic_id: clinicId }
    );

    if (error) {
      setListError(error.message);
      setRows([]);
      setListLoading(false);
      return;
    }

    if (csErr) {
      setListError(
        `${csErr.message} — Se usar agendamentos pelo n8n (cs_agendamentos), execute supabase/painel_cs_agendamentos_rpc.sql no Supabase.`
      );
    }

    const fromPainel = (data ?? []) as unknown as AppointmentRow[];
    const fromN8n = parseCsPainelRows(csRaw);
    const merged = [...fromPainel, ...fromN8n].sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );
    setRows(merged);
    setListLoading(false);
  }, [supabase, access]);

  const tabFilteredRows = useMemo(() => {
    const base = rows.filter((r) => r.status !== "cancelled");
    if (listFilter === "all") return base;
    if (listFilter === "pending") {
      return base.filter(
        (r) => r.status === "scheduled" && awaitsConfirmation(r)
      );
    }
    return base.filter(
      (r) => r.status === "scheduled" && isClinicConfirmed(r)
    );
  }, [rows, listFilter]);

  const listDisplayRows = useMemo(
    () =>
      tabFilteredRows.filter((r) =>
        matchesLocalDayKey(r.starts_at, dayKey)
      ),
    [tabFilteredRows, dayKey]
  );

  const statsDayRows = useMemo(
    () =>
      rows
        .filter((r) => r.status !== "cancelled")
        .filter((r) => matchesLocalDayKey(r.starts_at, dayKey)),
    [rows, dayKey]
  );

  const stats = useMemo(() => {
    const scheduled = statsDayRows.filter((r) => r.status === "scheduled");
    const pending = scheduled.filter((r) => awaitsConfirmation(r)).length;
    const confirmedOnDay = scheduled.filter((r) => isClinicConfirmed(r))
      .length;
    return {
      totalScheduled: scheduled.length,
      pending,
      confirmedOnDay,
    };
  }, [statsDayRows]);

  const confirmAppointment = useCallback(
    async (id: string) => {
      if (!supabase || access?.kind !== "clinic") return;
      setRowBusy(id);
      setListError(null);
      let error: { message: string; code?: string } | null = null;

      if (id.startsWith("cs:")) {
        const { error: e } = await supabase.rpc("painel_confirm_cs_agendamento", {
          p_clinic_id: access.clinicId,
          p_cs_agendamento_id: id.slice(3),
        });
        error = e;
      } else {
        const { error: e } = await supabase
          .from("appointments")
          .update({ source: "painel" })
          .eq("id", id);
        error = e;
      }

      setRowBusy(null);
      if (error) {
        setListError(
          error.message +
            (error.message.includes("permission") || error.code === "42501"
              ? " — Execute supabase/rls_owner_update_appointments.sql ou painel_cs_agendamentos_rpc.sql."
              : "")
        );
        return;
      }
      await loadAppointments();
    },
    [supabase, access, loadAppointments]
  );

  const removeAppointment = useCallback(
    async (id: string) => {
      if (!supabase || access?.kind !== "clinic") return;
      if (!window.confirm("Cancelar este agendamento?")) return;
      setRowBusy(id);
      setListError(null);
      let error: { message: string; code?: string } | null = null;

      if (id.startsWith("cs:")) {
        const { error: e } = await supabase.rpc("painel_cancel_cs_agendamento", {
          p_clinic_id: access.clinicId,
          p_cs_agendamento_id: id.slice(3),
        });
        error = e;
      } else {
        const { error: e } = await supabase
          .from("appointments")
          .update({ status: "cancelled" })
          .eq("id", id);
        error = e;
      }

      setRowBusy(null);
      if (error) {
        setListError(
          error.message +
            (error.message.includes("permission") || error.code === "42501"
              ? " — Execute supabase/rls_owner_update_appointments.sql ou painel_cs_agendamentos_rpc.sql."
              : "")
        );
        return;
      }
      await loadAppointments();
    },
    [supabase, access, loadAppointments]
  );

  const selectedDayLabel = useMemo(() => {
    if (!dayKey) return "A carregar…";
    return new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(parseLocalYmd(dayKey));
  }, [dayKey]);

  const calendarFocusDate = useMemo(
    () => (dayKey ? parseLocalYmd(dayKey) : undefined),
    [dayKey]
  );

  useEffect(() => {
    if (!supabase || !session?.user) {
      setAccess(null);
      return;
    }
    let cancelled = false;
    setAccess({ kind: "loading" });
    const uid = session.user.id;
    void (async () => {
      const { data: clinic, error: ec } = await supabase
        .from("clinics")
        .select("id, name")
        .eq("owner_id", uid)
        .maybeSingle();
      if (cancelled) return;
      if (ec) {
        setAccess({ kind: "denied", message: ec.message });
        return;
      }
      if (clinic?.id) {
        setAccess({
          kind: "clinic",
          clinicId: clinic.id,
          clinicName: clinic.name,
        });
        return;
      }
      setAccess({ kind: "onboarding" });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, session?.user?.id]);

  useEffect(() => {
    if (
      !access ||
      access.kind === "loading" ||
      access.kind === "denied" ||
      access.kind === "onboarding"
    ) {
      return;
    }
    void loadAppointments();
  }, [access, loadAppointments]);

  const refreshHumanQueue = useCallback(async () => {
    if (!supabase || access?.kind !== "clinic") return;
    const { count, error: cErr } = await supabase
      .from("whatsapp_sessions")
      .select("*", { count: "exact", head: true })
      .eq("clinic_id", access.clinicId)
      .eq("needs_human", true)
      .eq("staff_handling", false);
    if (cErr) {
      setHumanQueueCount(0);
      return;
    }
    setHumanQueueCount(count ?? 0);
  }, [supabase, access]);

  useEffect(() => {
    void refreshHumanQueue();
  }, [refreshHumanQueue, whatsappHumanOpen]);

  useEffect(() => {
    if (!session) {
      setRows([]);
      setListError(null);
      setAccess(null);
    }
  }, [session]);

  useEffect(() => {
    if (!clientSynced || !supabase) return;
    if (!session?.user) {
      router.replace("/login");
    }
  }, [clientSynced, session?.user, supabase, router]);

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  if (!supabase) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-sm text-red-700 dark:text-red-400">
          Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY em
          .env.local (veja .env.example).
        </p>
      </div>
    );
  }

  if (!clientSynced) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-zinc-500">
        A carregar…
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center text-sm text-[#6b635a]">
        <p>A abrir a página de login…</p>
      </div>
    );
  }

  if (!access || access.kind === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#F9F7F2] px-4 text-[#6b635a]">
        <p className="text-sm">A carregar permissões…</p>
      </div>
    );
  }

  if (access.kind === "onboarding") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#F9F7F2] px-4 text-[#6b635a]">
        <p className="text-sm">A abrir o cadastro da clínica…</p>
      </div>
    );
  }

  if (access.kind === "denied") {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-display text-xl font-semibold text-[#2c2825]">
          Sem acesso ao painel
        </h1>
        <p className="mt-3 text-sm text-[#6b635a]">{access.message}</p>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="mt-6 rounded-lg bg-[#4D6D66] px-4 py-2 text-sm font-semibold text-white"
        >
          Sair
        </button>
      </div>
    );
  }

  const envClinic =
    (typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_CLINIC_NAME?.trim()) ||
    "";
  const headerClinicName = access.clinicName || envClinic || "Clínica";

  const filterActive =
    "rounded-full bg-[#3d6b62] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_-4px_rgba(61,107,98,0.55)] transition-transform duration-200 hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3d6b62]";
  const filterIdle =
    "rounded-full border border-[#dcd5ca] bg-white/90 px-5 py-2.5 text-sm font-medium text-[#4a453d] shadow-sm transition-all duration-200 hover:border-[#c9c2b6] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4D6D66]";
  const viewToggleActive =
    "rounded-lg bg-[#3d6b62] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors";
  const viewToggleIdle =
    "rounded-lg px-3.5 py-2 text-xs font-medium text-[#6b635a] transition-colors hover:bg-white";

  return (
    <div className="min-h-screen bg-[linear-gradient(165deg,#fbf9f5_0%,#f3efe6_45%,#f7f4ee_100%)] text-[#2c2825]">
      {supabase ? (
        <>
          <ScheduleAppointmentModal
            open={scheduleOpen}
            onClose={() => setScheduleOpen(false)}
            onSuccess={() => void loadAppointments()}
            supabase={supabase}
            clinicId={access.clinicId}
          />
          <ProfessionalsManagerModal
            open={professionalsOpen}
            onClose={() => setProfessionalsOpen(false)}
            supabase={supabase}
            clinicId={access.clinicId}
            onChanged={() => void loadAppointments()}
          />
          <WhatsappHumanModal
            open={whatsappHumanOpen}
            onClose={() => setWhatsappHumanOpen(false)}
            supabase={supabase}
            clinicId={access.clinicId}
            onClaimed={() => void refreshHumanQueue()}
          />
          <SlotsManagerModal
            open={slotsManagerOpen}
            onClose={() => setSlotsManagerOpen(false)}
            supabase={supabase}
            clinicId={access.clinicId}
            dayKey={dayKey}
            onAutoAdvanceDay={setDayKey}
          />
        </>
      ) : null}

      <header className="sticky top-0 z-30 border-b border-[#e8e2d9]/90 bg-[#fffdf9]/88 backdrop-blur-md shadow-[0_1px_0_rgba(44,40,37,0.04)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="hidden h-10 w-10 shrink-0 rounded-xl bg-[#3d6b62] shadow-inner sm:flex sm:items-center sm:justify-center"
              aria-hidden
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                className="text-white"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18M8 14h2v2H8z" />
              </svg>
            </div>
            <div className="min-w-0">
              <span className="block truncate text-[15px] font-semibold tracking-tight text-[#2a2623]">
                {headerClinicName}
              </span>
              <span className="mt-0.5 block text-xs text-[#8a8278]">
                Painel de agendamentos
              </span>
            </div>
          </div>
          <nav
            className="flex flex-wrap items-center justify-end gap-2 sm:gap-2.5"
            aria-label="Ações do painel"
          >
            <span className="order-last hidden max-w-[210px] truncate text-xs text-[#8a8278] lg:order-none lg:inline">
              {session.user.email}
            </span>
            <button
              type="button"
              title="Gerir profissionais"
              onClick={() => setProfessionalsOpen(true)}
              className="rounded-xl border border-[#c5d4d0] bg-white px-3.5 py-2.5 text-sm font-semibold text-[#3d6b62] shadow-sm transition-colors hover:bg-[#f4faf8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3d6b62]"
            >
              Profissionais
            </button>
            <button
              type="button"
              title="Marcar horários livres ou ocupados na agenda do WhatsApp"
              onClick={() => setSlotsManagerOpen(true)}
              className="rounded-xl border border-[#c9d4e8] bg-[#f5f8fc] px-3.5 py-2.5 text-sm font-semibold text-[#3d5a7a] shadow-sm transition-colors hover:bg-[#e8f0f8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3d5a7a]"
            >
              Horários (vagas)
            </button>
            <button
              type="button"
              title="Fila de atendimento humano no WhatsApp"
              onClick={() => setWhatsappHumanOpen(true)}
              className="relative rounded-xl border border-[#e8d4c8] bg-[#fff9f4] px-3.5 py-2.5 text-sm font-semibold text-[#8b4513] transition-colors hover:bg-[#fff0e6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c2410c]"
            >
              WhatsApp humano
              {humanQueueCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#c2410c] px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-[#fff9f4]">
                  {humanQueueCount > 99 ? "99+" : humanQueueCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              title="Criar novo agendamento"
              onClick={() => setScheduleOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#3d6b62] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_-4px_rgba(61,107,98,0.6)] transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_6px_20px_-4px_rgba(61,107,98,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3d6b62]"
            >
              <IconPlus className="shrink-0 opacity-95" />
              Novo agendamento
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="rounded-xl border border-[#dcd5ca] bg-white px-3.5 py-2.5 text-sm font-medium text-[#5c5348] transition-colors hover:bg-[#f7f4ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a8278]"
            >
              Sair
            </button>
          </nav>
        </div>
      </header>

      <main
        id="conteudo-principal"
        className="mx-auto max-w-6xl px-4 py-10 sm:px-6"
      >
        <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="agenda-animate-in max-w-xl" style={{ animationDelay: "0ms" }}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6f8f86]">
              Agenda do dia
            </p>
            <h1 className="mt-2 font-display text-[2.125rem] font-semibold leading-tight tracking-tight text-[#1f1c1a] md:text-[2.65rem]">
              Agendamentos
            </h1>
            <p className="mt-3 max-w-prose text-base leading-relaxed text-[#5c5348]">
              <span className="capitalize">{selectedDayLabel}</span>
              {dayKey && !isYmdToday(dayKey) && todayLabel ? (
                <span className="mt-1 block text-sm font-normal normal-case text-[#8a8278]">
                  Referência de hoje: {todayLabel}
                </span>
              ) : null}
            </p>
          </div>
          <div
            className="agenda-animate-in flex flex-wrap items-center gap-2 sm:justify-end"
            style={{ animationDelay: "45ms" }}
            role="tablist"
            aria-label="Filtrar por estado"
          >
            {(
              [
                ["all", "Todos"],
                ["pending", "Pendentes"],
                ["confirmed", "Confirmados"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={listFilter === value}
                onClick={() => setListFilter(value)}
                className={listFilter === value ? filterActive : filterIdle}
              >
                {label}
                {value === "pending" && stats.pending > 0 ? (
                  <span
                    className={`ml-1.5 inline-flex min-h-[1.25rem] min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                      listFilter === "pending"
                        ? "bg-white/20 text-white"
                        : "bg-[#fff0e6] text-[#b45309]"
                    }`}
                  >
                    {stats.pending > 99 ? "99+" : stats.pending}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="agenda-animate-in mb-8 flex flex-col gap-4 rounded-2xl border border-[#e8e2d9] bg-white/85 p-4 shadow-[0_8px_30px_-12px_rgba(44,40,37,0.12)] backdrop-blur-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!dayKey}
              onClick={() => dayKey && setDayKey((k) => addDaysToYmd(k, -1))}
              className="rounded-xl border border-[#dcd5ca] bg-white px-3.5 py-2.5 text-sm font-medium text-[#4a453d] shadow-sm transition-colors hover:bg-[#faf8f5] disabled:opacity-40"
            >
              Dia anterior
            </button>
            <label className="flex items-center gap-2 text-sm text-[#6b635a]">
              <span className="sr-only sm:not-sr-only">Data</span>
              <input
                type="date"
                disabled={!dayKey}
                value={dayKey}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) setDayKey(v);
                }}
                className="rounded-xl border border-[#dcd5ca] bg-white px-3 py-2.5 font-sans text-[#2c2825] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3d6b62] disabled:opacity-50"
              />
            </label>
            <button
              type="button"
              disabled={!dayKey}
              onClick={() => dayKey && setDayKey((k) => addDaysToYmd(k, 1))}
              className="rounded-xl border border-[#dcd5ca] bg-white px-3.5 py-2.5 text-sm font-medium text-[#4a453d] shadow-sm transition-colors hover:bg-[#faf8f5] disabled:opacity-40"
            >
              Próximo dia
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setDayKey(formatLocalYmd(now));
                setTodayLabel(
                  new Intl.DateTimeFormat("pt-BR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  }).format(now)
                );
              }}
              disabled={!dayKey || isYmdToday(dayKey)}
              className="rounded-xl bg-[#3d6b62] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#355a52] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Ir para hoje
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="flex items-center gap-0.5 rounded-xl border border-[#e6e1d8] bg-[#faf8f5] p-1"
              role="group"
              aria-label="Vista"
            >
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={
                  viewMode === "list" ? viewToggleActive : viewToggleIdle
                }
              >
                Lista
              </button>
              <button
                type="button"
                onClick={() => setViewMode("calendar")}
                className={
                  viewMode === "calendar" ? viewToggleActive : viewToggleIdle
                }
              >
                Calendário
              </button>
            </div>
            <button
              type="button"
              disabled={listLoading}
              onClick={() => void loadAppointments()}
              className="rounded-xl border border-[#dcd5ca] bg-white px-4 py-2.5 text-sm font-medium text-[#4a453d] shadow-sm transition-colors hover:bg-[#faf8f5] disabled:opacity-50"
            >
              Atualizar dados
            </button>
          </div>
        </div>

        <div
          className="mb-10 grid gap-4 sm:grid-cols-3"
          aria-label="Resumo numérico do dia"
        >
          <div className="agenda-animate-in group rounded-2xl border border-[#e8e2d9] bg-white/95 px-6 py-6 shadow-sm transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-md">
            <p className="font-display text-4xl font-semibold tabular-nums text-[#1f1c1a]">
              {stats.totalScheduled}
            </p>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7a7268]">
              No dia
            </p>
            <p className="mt-1 text-sm text-[#6b635a]">Consultas agendadas</p>
          </div>
          <div
            className="agenda-animate-in group rounded-2xl border border-[#edd8cc] bg-[#fffbf8] px-6 py-6 shadow-sm transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-md"
            style={{ animationDelay: "60ms" }}
          >
            <p className="font-display text-4xl font-semibold tabular-nums text-[#a85a2a]">
              {stats.pending}
            </p>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[#b45309]/90">
              Pendentes
            </p>
            <p className="mt-1 text-sm text-[#7a4a2c]">
              Inclui marcações via WhatsApp
            </p>
          </div>
          <div
            className="agenda-animate-in group rounded-2xl border border-[#d4e5df] bg-[#f7fdfa] px-6 py-6 shadow-sm transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-md"
            style={{ animationDelay: "120ms" }}
          >
            <p className="font-display text-4xl font-semibold tabular-nums text-[#3d6b62]">
              {stats.confirmedOnDay}
            </p>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[#4D6D66]">
              Confirmados
            </p>
            <p className="mt-1 text-sm text-[#3d5a52]">
              Validados no painel
            </p>
          </div>
        </div>

        {listError ? (
          <p
            className="agenda-animate-in mb-6 rounded-2xl border border-red-200/90 bg-red-50/95 px-4 py-3.5 text-sm leading-relaxed text-red-900 shadow-sm"
            role="alert"
          >
            {listError}
          </p>
        ) : null}

        {viewMode === "calendar" ? (
          <AppointmentsCalendar
            rows={tabFilteredRows}
            loading={listLoading}
            focusDate={calendarFocusDate}
          />
        ) : listLoading && !rows.length ? (
          <AgendaListSkeleton />
        ) : listDisplayRows.length === 0 ? (
          <div className="agenda-animate-in rounded-[1.35rem] border border-[#e8e2d9] bg-white/95 px-8 py-14 text-center shadow-[0_8px_40px_-16px_rgba(44,40,37,0.15)]">
            <div
              className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f0f5f3] text-[#3d6b62]"
              aria-hidden
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
              >
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
            </div>
            <p className="font-display text-xl font-semibold text-[#2c2825]">
              {tabFilteredRows.length === 0
                ? "Nenhum agendamento neste filtro"
                : "Nenhum agendamento neste dia"}
            </p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#6b635a]">
              {tabFilteredRows.length > 0 && listDisplayRows.length === 0 ? (
                <>
                  Existem marcações em outros dias com este filtro. Use{" "}
                  <strong className="font-medium text-[#3d524d]">
                    Dia anterior
                  </strong>
                  ,{" "}
                  <strong className="font-medium text-[#3d524d]">
                    Próximo dia
                  </strong>{" "}
                  ou o campo de data para navegar.
                </>
              ) : (
                <>
                  As reservas feitas pelo WhatsApp aparecem como{" "}
                  <strong className="font-medium text-[#9a4f1c]">
                    Pendentes
                  </strong>{" "}
                  até confirmar no painel. Depois ficam como{" "}
                  <strong className="font-medium text-[#3d6b62]">
                    Confirmados
                  </strong>
                  .
                </>
              )}
            </p>
          </div>
        ) : (
          <AppointmentCardList
            rows={listDisplayRows}
            busyId={rowBusy}
            onConfirm={(id) => void confirmAppointment(id)}
            onRemove={(id) => void removeAppointment(id)}
          />
        )}
      </main>
    </div>
  );
}
