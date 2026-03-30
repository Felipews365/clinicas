"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AppointmentCardList } from "@/components/appointment-card-list";
import { AppointmentsCalendar } from "@/components/appointments-calendar";
import { ProceduresManagerModal } from "@/components/procedures-manager-modal";
import { ProfessionalsManagerModal } from "@/components/professionals-manager-modal";
import { ScheduleAppointmentModal } from "@/components/schedule-appointment-modal";
import { ClinicAgendaHoursModal } from "@/components/clinic-agenda-hours-modal";
import { SlotsManagerModal } from "@/components/slots-manager-modal";
import { WhatsappHumanModal } from "@/components/whatsapp-human-modal";
import { ReportModal } from "@/components/report-modal";
import { AgentConfigModal } from "@/components/agent-config-modal";
import {
  addDaysToYmd,
  formatLocalYmd,
  isYmdToday,
  matchesLocalDayKey,
  parseLocalYmd,
} from "@/lib/local-day";
import {
  calendarSlotBoundsFromVisibleHours,
  normalizeAgendaVisibleHours,
} from "@/lib/clinic-agenda-hours";
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

function IconMenu({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function IconClose({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}


function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const playTone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    playTone(880, 0, 0.18);
    playTone(1100, 0.14, 0.22);
    void ctx.resume();
  } catch {
    /* Web Audio not available */
  }
}

type AppointmentNotif = {
  uid: string;
  type: "new" | "cancelled" | "rescheduled";
  time?: string;
};

function NotifToast({
  notif,
  onClose,
}: {
  notif: AppointmentNotif;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 7000);
    return () => clearTimeout(t);
  }, [onClose]);

  const config = {
    new: {
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18M8 14h2v2H8z" />
        </svg>
      ),
      bg: "bg-[#0f766e]",
      title: "Novo agendamento",
      sub: notif.time ? `Marcado para as ${notif.time}` : "Recebido pelo WhatsApp",
    },
    cancelled: {
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" />
        </svg>
      ),
      bg: "bg-[#dc2626]",
      title: "Agendamento cancelado",
      sub: notif.time ? `Horário das ${notif.time}` : "Cliente cancelou",
    },
    rescheduled: {
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      ),
      bg: "bg-[#d97706]",
      title: "Reagendamento",
      sub: notif.time ? `Novo horário: ${notif.time}` : "Cliente reagendou",
    },
  }[notif.type];

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 rounded-2xl bg-white shadow-xl border border-[#e2e8f0] p-4 pr-3 min-w-[280px] max-w-xs animate-in slide-in-from-right-4 fade-in duration-300"
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${config.bg}`}>
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1e293b]">{config.title}</p>
        <p className="text-xs text-[#64748b] mt-0.5">{config.sub}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar notificação"
        className="ml-1 shrink-0 rounded-lg p-1 text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#475569] transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
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
  const [proceduresOpen, setProceduresOpen] = useState(false);
  type SidebarPage =
    | "dashboard"
    | "professionals"
    | "slots"
    | "clinic-hours"
    | "whatsapp-human"
    | "agent"
    | "report";
  const [sidebarPage, setSidebarPage] = useState<SidebarPage>("dashboard");
  const [clinicAgendaHours, setClinicAgendaHours] = useState<number[]>(() =>
    normalizeAgendaVisibleHours(null)
  );
  const [clinicSlotsExpediente, setClinicSlotsExpediente] = useState<unknown>(
    null
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [humanQueueCount, setHumanQueueCount] = useState(0);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessState | null>(null);
  const [notifs, setNotifs] = useState<AppointmentNotif[]>([]);
  const locallyModified = useRef(new Set<string>());
  const prevRowsRef = useRef<AppointmentRow[]>([]);
  /** Vazio até ao mount no cliente — evita hidratação (data UTC vs fuso local). */
  const [dayKey, setDayKey] = useState("");
  const [todayLabel, setTodayLabel] = useState("");
  /** Evita ghost click: fechar menu e abrir modal no mesmo toque disparava o backdrop (fechar). */
  const mobileModalOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const openModalAfterMobileMenuClose = useCallback((openFn: () => void) => {
    if (mobileModalOpenTimerRef.current != null) {
      clearTimeout(mobileModalOpenTimerRef.current);
      mobileModalOpenTimerRef.current = null;
    }
    setMobileMenuOpen(false);
    mobileModalOpenTimerRef.current = setTimeout(() => {
      mobileModalOpenTimerRef.current = null;
      openFn();
    }, 60);
  }, []);

  useEffect(() => {
    return () => {
      if (mobileModalOpenTimerRef.current != null) {
        clearTimeout(mobileModalOpenTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [sidebarPage]);

  const goToSidebarPageAfterMobileMenuClose = useCallback(
    (page: SidebarPage) => {
      if (mobileModalOpenTimerRef.current != null) {
        clearTimeout(mobileModalOpenTimerRef.current);
        mobileModalOpenTimerRef.current = null;
      }
      setMobileMenuOpen(false);
      mobileModalOpenTimerRef.current = setTimeout(() => {
        mobileModalOpenTimerRef.current = null;
        setSidebarPage(page);
      }, 60);
    },
    []
  );

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
    prevRowsRef.current = merged;
    setListLoading(false);
  }, [supabase, access]);

  const loadClinicAgendaSettings = useCallback(async () => {
    if (!supabase || access?.kind !== "clinic") return;
    const { data, error } = await supabase
      .from("clinics")
      .select("agenda_visible_hours, slots_expediente")
      .eq("id", access.clinicId)
      .maybeSingle();
    if (error) return;
    const row = data as {
      agenda_visible_hours?: unknown;
      slots_expediente?: unknown;
    } | null;
    if (row) {
      setClinicAgendaHours(normalizeAgendaVisibleHours(row.agenda_visible_hours));
      setClinicSlotsExpediente(row.slots_expediente ?? null);
    }
  }, [supabase, access]);

  useEffect(() => {
    void loadClinicAgendaSettings();
  }, [loadClinicAgendaSettings]);

  const calendarSlotBounds = useMemo(
    () => calendarSlotBoundsFromVisibleHours(clinicAgendaHours),
    [clinicAgendaHours]
  );

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

      locallyModified.current.add(id);
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

      locallyModified.current.delete(id);
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
      if (
        !window.confirm(
          "Deseja realmente excluir / cancelar este agendamento? Esta ação não pode ser desfeita."
        )
      )
        return;
      setRowBusy(id);
      setListError(null);
      let error: { message: string; code?: string } | null = null;

      locallyModified.current.add(id);
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

      locallyModified.current.delete(id);
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
  }, [refreshHumanQueue, sidebarPage]);

  useEffect(() => {
    if (!supabase || access?.kind !== "clinic") return;
    const clinicId = access.clinicId;

    const fmt = (iso: string) =>
      new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

    const pushNotif = (type: AppointmentNotif["type"], startsAt?: string) => {
      playNotificationSound();
      setNotifs((prev) => [
        { uid: crypto.randomUUID(), type, time: startsAt ? fmt(startsAt) : undefined },
        ...prev.slice(0, 4),
      ]);
    };

    const channel = supabase
      .channel(`appt-notif:${clinicId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          const row = payload.new as { id: string; source?: string | null; starts_at?: string };
          if (locallyModified.current.has(row.id)) return;
          if (row.source === "painel") return;
          pushNotif("new", row.starts_at);
          void loadAppointments();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          const row = payload.new as { id: string; status?: string; starts_at?: string };
          if (locallyModified.current.has(row.id)) return;
          const prev = prevRowsRef.current.find((r) => r.id === row.id);
          if (row.status === "cancelled" && prev?.status !== "cancelled") {
            pushNotif("cancelled", row.starts_at);
          } else if (prev && row.starts_at && prev.starts_at !== row.starts_at) {
            pushNotif("rescheduled", row.starts_at);
          } else {
            return;
          }
          void loadAppointments();
        }
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [supabase, access, loadAppointments]);

  useEffect(() => {
    if (!session) {
      setRows([]);
      setListError(null);
      setAccess(null);
    }
  }, [session]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileMenuOpen]);

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
    "rounded-full bg-[#0f766e] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-[#0d6560]";
  const filterIdle =
    "rounded-full border border-[#e2e8f0] bg-white px-5 py-2.5 text-sm font-medium text-[#64748b] shadow-sm transition-all duration-200 hover:border-[#cbd5e1] hover:bg-white";
  const viewToggleActive =
    "rounded-lg bg-[#0f766e] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors";
  const viewToggleIdle =
    "rounded-lg px-3.5 py-2 text-xs font-medium text-[#64748b] transition-colors hover:bg-[#f8fafc]";
  const sidebarNavActive =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#0f766e] bg-[#e8f5f2] shadow-sm transition-colors";
  const sidebarNavIdle =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#4a7a76] transition-colors hover:bg-[#f0faf8] hover:text-[#0f766e]";
  function sidebarNavClass(page: SidebarPage) {
    return sidebarPage === page ? sidebarNavActive : sidebarNavIdle;
  }
  function mobileNavRowClass(page: SidebarPage) {
    return `flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors ${
      sidebarPage === page
        ? "bg-[#e8f5f2] font-semibold text-[#0f766e]"
        : "font-medium text-[#4a7a76] hover:bg-[#f0faf8]"
    }`;
  }

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-gradient-to-br from-[#e5f3f0] to-[#ebebf5] text-[#1e293b] sm:flex-row">
      {supabase ? (
        <>
          <ScheduleAppointmentModal
            open={scheduleOpen}
            onClose={() => setScheduleOpen(false)}
            onSuccess={() => void loadAppointments()}
            supabase={supabase}
            clinicId={access.clinicId}
            clinicVisibleHours={clinicAgendaHours}
          />
          <ProceduresManagerModal
            open={proceduresOpen}
            onClose={() => setProceduresOpen(false)}
            supabase={supabase}
            clinicId={access.clinicId}
          />
        </>
      ) : null}

      {/* Sidebar desktop: largura fixa, altura viewport, scroll só no nav */}
      <aside className="z-20 hidden h-full w-[260px] shrink-0 flex-col overflow-hidden border-r border-[#e8efed] bg-white shadow-[2px_0_24px_rgba(0,0,0,0.04)] sm:flex sm:flex-col">
        {/* Logo */}
        <button
          type="button"
          onClick={() => setSidebarPage("dashboard")}
          className="flex w-full items-center gap-2.5 border-b border-[#f0f4f3] px-5 py-5 text-left transition-colors hover:bg-[#f7fcfb]"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0f766e]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2v2H8z"/></svg>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight text-[#0f4c44]">{headerClinicName}</p>
            <p className="text-[10px] text-[#6b9e97]">Painel</p>
          </div>
        </button>
        {/* New appointment button */}
        <div className="px-3 pt-4 pb-2">
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#0d6560] hover:shadow-md"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            Novo agendamento
          </button>
        </div>
        {/* Nav items */}
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Navegação principal">
          <button
            type="button"
            onClick={() => setSidebarPage("dashboard")}
            className={sidebarNavClass("dashboard")}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setSidebarPage("professionals")}
            className={sidebarNavClass("professionals")}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Profissionais
          </button>
          <button
            type="button"
            onClick={() => setSidebarPage("clinic-hours")}
            className={`${sidebarNavClass("clinic-hours")} !items-start py-3`}
            aria-label="Horários da clínica"
          >
            <span className="mt-0.5 shrink-0 text-[1.05rem] leading-none" aria-hidden>
              📅
            </span>
            <span className="min-w-0 flex-1 text-left leading-snug">
              <span className="block">Horários da</span>
              <span className="block">clínica</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSidebarPage("slots")}
            className={`${sidebarNavClass("slots")} !items-start py-3`}
            aria-label="Horários por Dr ou Dra."
          >
            <span className="mt-0.5 shrink-0 text-[1.05rem] leading-none" aria-hidden>
              🩺
            </span>
            <span className="min-w-0 flex-1 text-left leading-snug">
              <span className="block">Horários por</span>
              <span className="block">Dr ou Dra.</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSidebarPage("whatsapp-human")}
            className={`relative ${sidebarNavClass("whatsapp-human")}`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            WhatsApp humano
            {humanQueueCount > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#c2410c] px-1 text-[10px] font-bold text-white">
                {humanQueueCount > 99 ? "99+" : humanQueueCount}
              </span>
            )}
          </button>
          <button type="button" onClick={() => setSidebarPage("agent")} className={sidebarNavClass("agent")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 15h.01M12 15h.01M16 15h.01"/></svg>
            Agente IA
          </button>
          <button type="button" onClick={() => setSidebarPage("report")} className={sidebarNavClass("report")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Relatório
          </button>
        </nav>
        {/* Footer */}
        <div className="border-t border-[#f0f4f3] px-3 py-3 space-y-0.5">
          <p className="truncate px-3 py-1 text-[11px] text-[#8ba9a6]">{session.user.email}</p>
          <button type="button" onClick={() => void handleSignOut()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#4a7a76] transition-colors hover:bg-[#f0faf8] hover:text-[#0f766e]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            Sair
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className={`sticky top-0 z-30 shrink-0 border-b border-white/60 bg-white/70 backdrop-blur-md sm:hidden ${mobileMenuOpen ? "z-[60]" : "z-30"}`}>
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm text-[#1e293b] transition-colors hover:bg-[#f0faf8]"
            aria-expanded={mobileMenuOpen}
            aria-controls="painel-menu-mobile"
            onClick={() => setMobileMenuOpen((o) => !o)}
          >
            <span className="sr-only">{mobileMenuOpen ? "Fechar menu" : "Abrir menu"}</span>
            {mobileMenuOpen ? <IconClose className="shrink-0" /> : <IconMenu className="shrink-0" />}
          </button>
          <button
            type="button"
            className="flex-1 min-w-0 text-left"
            onClick={() => {
              setSidebarPage("dashboard");
              setMobileMenuOpen(false);
            }}
          >
            <p className="truncate text-sm font-bold text-[#0f4c44]">{headerClinicName}</p>
            <p className="text-[10px] text-[#6b9e97]">Painel de agendamentos</p>
          </button>
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0f766e] text-white shadow-sm"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </header>

      {mobileMenuOpen ? (
        <>
          <button
            type="button"
            className="agenda-drawer-backdrop fixed inset-0 z-40 bg-[#1e293b]/30 backdrop-blur-[2px] sm:hidden"
            aria-label="Fechar menu"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            id="painel-menu-mobile"
            className="agenda-drawer-panel fixed inset-y-0 left-0 z-50 flex w-[min(82vw,18rem)] flex-col sm:hidden"
            style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="painel-menu-mobile-title"
          >
            <div className="flex h-full flex-col overflow-hidden bg-white shadow-[4px_0_32px_rgba(0,0,0,0.1)]">
              <button
                type="button"
                className="flex w-full items-center gap-2.5 border-b border-[#f0f4f3] px-5 py-5 text-left hover:bg-[#f7fcfb]"
                onClick={() => goToSidebarPageAfterMobileMenuClose("dashboard")}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0f766e]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2v2H8z"/></svg>
                </div>
                <div className="min-w-0">
                  <p id="painel-menu-mobile-title" className="truncate text-sm font-bold text-[#0f4c44]">{headerClinicName}</p>
                  <p className="text-[10px] text-[#6b9e97]">Painel · toque para o Dashboard</p>
                </div>
              </button>
              {/* New appointment */}
              <div className="px-4 pt-4 pb-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white"
                  onClick={() =>
                    openModalAfterMobileMenuClose(() => setScheduleOpen(true))
                  }
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
                  Novo agendamento
                </button>
              </div>
              {/* Nav */}
              <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Ações do painel (mobile)">
                <button
                  type="button"
                  className={mobileNavRowClass("dashboard")}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("dashboard")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f5f2] text-[#0f766e]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>
                  Dashboard
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("professionals")}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("professionals")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f5f2] text-[#0f766e]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
                  Profissionais
                </button>
                <button
                  type="button"
                  className={`${mobileNavRowClass("clinic-hours")} !items-start py-3`}
                  aria-label="Horários da clínica"
                  onClick={() => goToSidebarPageAfterMobileMenuClose("clinic-hours")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f5f2] text-lg leading-none">
                    📅
                  </span>
                  <span className="min-w-0 flex-1 text-left leading-snug">
                    <span className="block">Horários da</span>
                    <span className="block">clínica</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`${mobileNavRowClass("slots")} !items-start py-3`}
                  aria-label="Horários por Dr ou Dra."
                  onClick={() => goToSidebarPageAfterMobileMenuClose("slots")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f5f2] text-lg leading-none">
                    🩺
                  </span>
                  <span className="min-w-0 flex-1 text-left leading-snug">
                    <span className="block">Horários por</span>
                    <span className="block">Dr ou Dra.</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`relative ${mobileNavRowClass("whatsapp-human")}`}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("whatsapp-human")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f5f2] text-[#0f766e]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
                  <span className="flex-1 text-left">WhatsApp humano</span>
                  {humanQueueCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#c2410c] px-1 text-[10px] font-bold text-white">{humanQueueCount > 99 ? "99+" : humanQueueCount}</span>}
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("agent")}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("agent")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f5f2] text-[#0f766e]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 15h.01M12 15h.01M16 15h.01"/></svg></span>
                  Agente IA
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("report")}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("report")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f5f2] text-[#0f766e]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
                  Relatório
                </button>
              </nav>
              {/* Footer */}
              <div className="border-t border-[#f0f4f3] px-3 py-3 space-y-0.5">
                <p className="truncate px-3 py-1 text-[11px] text-[#8ba9a6]">{session.user.email}</p>
                <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-[#4a7a76] hover:bg-[#f0faf8]" onClick={() => { setMobileMenuOpen(false); void handleSignOut(); }}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#f5f5f5] text-[#64748b]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg></span>
                  Sair
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      <main
        id="conteudo-principal"
        className="painel-main-area flex-1 min-h-0 w-full min-w-0 overflow-y-auto overscroll-contain px-4 py-6 sm:px-7 sm:py-6"
      >
        <div className="painel-page-shell w-full max-w-none">
        {sidebarPage === "dashboard" ? (
        <>
        <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="agenda-animate-in max-w-xl" style={{ animationDelay: "0ms" }}>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#0f766e]">
              Agenda do dia
            </p>
            <h1 className="mt-2 font-bold text-3xl text-[#0f2d28] sm:text-4xl">
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

        <div className="agenda-animate-in mb-8 flex flex-col gap-4 rounded-2xl bg-white shadow-sm p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!dayKey}
              onClick={() => dayKey && setDayKey((k) => addDaysToYmd(k, -1))}
              className="rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm font-semibold text-[#475569] shadow-sm transition-colors hover:bg-[#f8fafc]"
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
              className="rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm font-semibold text-[#475569] shadow-sm transition-colors hover:bg-[#f8fafc]"
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
              className="rounded-xl bg-[#0f766e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0d6560] disabled:opacity-40"
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
              className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-medium text-[#475569] shadow-sm transition-colors hover:bg-[#f8fafc] disabled:opacity-50"
            >
              Atualizar dados
            </button>
          </div>
        </div>

        <div
          className="mb-10 grid gap-4 sm:grid-cols-3"
          aria-label="Resumo numérico do dia"
        >
          <div className="agenda-animate-in rounded-2xl bg-white shadow-sm px-6 py-5">
            <p className="font-display text-4xl font-semibold tabular-nums text-[#0f766e]">
              {stats.totalScheduled}
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
              No dia
            </p>
            <p className="mt-1 text-sm text-[#64748b]">Consultas agendadas</p>
          </div>
          <div
            className="agenda-animate-in rounded-2xl bg-white shadow-sm px-6 py-5"
            style={{ animationDelay: "60ms" }}
          >
            <p className="font-display text-4xl font-semibold tabular-nums text-[#dc6526]">
              {stats.pending}
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
              Pendentes
            </p>
            <p className="mt-1 text-sm text-[#64748b]">
              Inclui marcações via WhatsApp
            </p>
          </div>
          <div
            className="agenda-animate-in rounded-2xl bg-white shadow-sm px-6 py-5"
            style={{ animationDelay: "120ms" }}
          >
            <p className="font-display text-4xl font-semibold tabular-nums text-[#0f766e]">
              {stats.confirmedOnDay}
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">
              Confirmados
            </p>
            <p className="mt-1 text-sm text-[#64748b]">
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
            slotMinTime={calendarSlotBounds.slotMinTime}
            slotMaxTime={calendarSlotBounds.slotMaxTime}
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
        </>
        ) : supabase ? (
          <div className="w-full min-w-0">
            {sidebarPage === "professionals" ? (
              <ProfessionalsManagerModal
                presentation="panel"
                open
                onClose={() => setSidebarPage("dashboard")}
                supabase={supabase}
                clinicId={access.clinicId}
                onChanged={() => void loadAppointments()}
              />
            ) : null}
            {sidebarPage === "slots" ? (
              <SlotsManagerModal
                presentation="panel"
                open
                onClose={() => setSidebarPage("dashboard")}
                supabase={supabase}
                clinicId={access.clinicId}
                dayKey={dayKey}
                onAutoAdvanceDay={setDayKey}
                onDayKeyChange={setDayKey}
                clinicVisibleHours={clinicAgendaHours}
                clinicSlotsExpediente={clinicSlotsExpediente}
              />
            ) : null}
            {sidebarPage === "clinic-hours" ? (
              <ClinicAgendaHoursModal
                presentation="panel"
                open
                onClose={() => setSidebarPage("dashboard")}
                supabase={supabase}
                clinicId={access.clinicId}
                onSaved={(hours) => setClinicAgendaHours(hours)}
              />
            ) : null}
            {sidebarPage === "whatsapp-human" ? (
              <WhatsappHumanModal
                presentation="panel"
                open
                onClose={() => setSidebarPage("dashboard")}
                supabase={supabase}
                clinicId={access.clinicId}
                onClaimed={() => void refreshHumanQueue()}
              />
            ) : null}
            {sidebarPage === "agent" ? (
              <AgentConfigModal
                presentation="panel"
                open
                onClose={() => setSidebarPage("dashboard")}
                supabase={supabase}
                clinicId={access.clinicId}
              />
            ) : null}
            {sidebarPage === "report" ? (
              <ReportModal
                presentation="panel"
                open
                onClose={() => setSidebarPage("dashboard")}
                rows={rows}
              />
            ) : null}
          </div>
        ) : null}
        </div>
      </main>
      </div>

      {/* Notificações em tempo real */}
      {notifs.length > 0 && (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
          {notifs.map((n) => (
            <NotifToast
              key={n.uid}
              notif={n}
              onClose={() => setNotifs((prev) => prev.filter((x) => x.uid !== n.uid))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
