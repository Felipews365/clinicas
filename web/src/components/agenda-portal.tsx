"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ProceduresManagerModal } from "@/components/procedures-manager-modal";
import { ProfessionalsManagerModal } from "@/components/professionals-manager-modal";
import { RescheduleAppointmentModal } from "@/components/reschedule-appointment-modal";
import { ScheduleAppointmentModal } from "@/components/schedule-appointment-modal";
import { ClinicAgendaHoursModal } from "@/components/clinic-agenda-hours-modal";
import { SlotsManagerModal } from "@/components/slots-manager-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { WhatsappHumanModal } from "@/components/whatsapp-human-modal";
import { ReportModal } from "@/components/report-modal";
import { AgentConfigModal } from "@/components/agent-config-modal";
import { ClinicProfilePanel } from "@/components/clinic-profile-panel";
import { ClinicSubscriptionPanel } from "@/components/clinic-subscription-panel";
import { ConectarWhatsapp } from "@/components/conectar-whatsapp";
import { WhatsappInbox } from "@/components/whatsapp-inbox";
import { PainelClientesCs } from "@/components/painel-clientes-cs";
import {
  addDaysToYmd,
  formatLocalYmd,
  isYmdToday,
  localYmdFromIso,
  matchesLocalDayKey,
  parseLocalYmd,
} from "@/lib/local-day";
import {
  NotificationAlertsPage,
  NotificationToastStack,
} from "@/components/notification-center";
import { PainelDashboard } from "@/components/painel-dashboard";
import { useAgendaNotifications } from "@/hooks/use-agenda-notifications";
import {
  calendarSlotBoundsFromVisibleHours,
  clinicVisibleHoursForDayKey,
  normalizeAgendaVisibleHours,
  normalizeSabadoAgendaHours,
  type ClinicAgendaWeekendConfig,
} from "@/lib/clinic-agenda-hours";
import { resolveProfessionalCardStyle } from "@/lib/professional-palette";
import { hasFullAccess } from "@/lib/crm-access";
import { getSupportWhatsAppActivatePlanUrl } from "@/lib/support-whatsapp";
import { createClient } from "@/lib/supabase/client";
import { isClinicMembersUnavailableError } from "@/lib/supabase/clinic-members-compat";
import { withProfessionalsGenderFallback } from "@/lib/supabase-gender-column-fallback";
import {
  awaitsConfirmation,
  isClinicConfirmed,
  one,
  type AppointmentRow,
} from "@/types/appointments";
import {
  csAgendamentoUuidFromPanelId,
  fireNotifyProfessionalAfterPanelCancel,
  fireNotifyProfessionalFromAgendaDiff,
  painelRpcCancelCsErrorMessage,
} from "@/lib/painel-notify-professional";

function rowProfessionalId(r: AppointmentRow): string | null {
  const raw = one(r.professionals)?.id;
  if (raw == null || raw === "") return null;
  return String(raw);
}

/** Compara nomes exibidos (agendamentos CS podem vir só com nome, sem id de `professionals`). */
function normalizeProfessionalName(s: string | null | undefined): string {
  if (!s?.trim()) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function rowMatchesProfessionalFilter(
  r: AppointmentRow,
  profFilterId: string,
  roster: readonly { id: string; name: string }[]
): boolean {
  if (rowProfessionalId(r) === profFilterId) return true;
  const entry = roster.find((p) => p.id === profFilterId);
  if (!entry) return false;
  const embedName = one(r.professionals)?.name ?? "";
  if (!embedName.trim()) return false;
  return (
    normalizeProfessionalName(embedName) ===
    normalizeProfessionalName(entry.name)
  );
}

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

type AppointmentSnapshot = Map<
  string,
  { status: AppointmentRow["status"]; starts_at: string }
>;

function buildAppointmentSnapshot(rows: AppointmentRow[]): AppointmentSnapshot {
  const m = new Map();
  for (const r of rows) {
    m.set(r.id, { status: r.status, starts_at: r.starts_at });
  }
  return m;
}

/** Instant no tempo para comparar inícios (mesmo horário em ISO diferentes → sem falso reagendamento). */
function apptStartsAtInstantMs(iso: string | null | undefined): number | null {
  if (iso == null || iso === "") return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function apptStartsAtChanged(prevIso: string, nextIso: string): boolean {
  const a = apptStartsAtInstantMs(prevIso);
  const b = apptStartsAtInstantMs(nextIso);
  if (a != null && b != null) return a !== b;
  return prevIso !== nextIso;
}

function formatNotifClock(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function notificationFromRow(
  r: AppointmentRow,
  kind: "agendamento" | "cancelamento" | "reagendamento",
  opts?: { prevStartsAt?: string }
) {
  const patient = one(r.patients)?.name?.trim() || "Cliente";
  const prof = one(r.professionals)?.name?.trim() || "Profissional";
  const t = formatNotifClock(r.starts_at);
  if (kind === "agendamento") {
    return {
      tipo: "agendamento" as const,
      titulo: "Novo agendamento",
      mensagem: `${patient} às ${t} com ${prof}`,
      horario: r.starts_at,
      appointmentId: r.id,
    };
  }
  if (kind === "cancelamento") {
    return {
      tipo: "cancelamento" as const,
      titulo: "Cancelamento",
      mensagem: `${patient} cancelou a consulta das ${t}`,
      horario: r.starts_at,
      appointmentId: r.id,
    };
  }
  const pt = opts?.prevStartsAt
    ? formatNotifClock(opts.prevStartsAt)
    : "—";
  return {
    tipo: "reagendamento" as const,
    titulo: "Reagendamento",
    mensagem: `${patient} mudou de ${pt} para ${t}`,
    horario: r.starts_at,
    appointmentId: r.id,
  };
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

function IconChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
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
  const [profFilterId, setProfFilterId] = useState<string | null>(null);
  const [profRoster, setProfRoster] = useState<
    {
      id: string;
      name: string;
      panel_color: string | null;
      cs_profissional_id: string | null;
      is_active: boolean;
      whatsapp: string | null;
    }[]
  >([]);
  const [viewMode, setViewMode] = useState<"calendar" | "list" | "grid">(
    "list"
  );
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [proceduresOpen, setProceduresOpen] = useState(false);
  type SidebarPage =
    | "dashboard"
    | "professionals"
    | "slots"
    | "clinic-profile"
    | "clinic-hours"
    | "whatsapp-human"
    | "whatsapp-connect"
    | "whatsapp-inbox"
    | "cs-clientes"
    | "clinic-subscription"
    | "agent"
    | "report"
    | "alerts"
    | "crm";
  const [sidebarPage, setSidebarPage] = useState<SidebarPage>("dashboard");
  /** Vindo da grelha de horários: abrir Profissionais já em edição deste nome. */
  const [professionalsOpenIntent, setProfessionalsOpenIntent] = useState<{
    focusName: string;
  } | null>(null);
  const [crmSubscription, setCrmSubscription] = useState<
    | { loaded: false }
    | { loaded: true; hasAccess: boolean; tipo_plano: string }
  >({ loaded: false });
  const [crmUpgradeOpen, setCrmUpgradeOpen] = useState(false);
  const [clinicAgendaHours, setClinicAgendaHours] = useState<number[]>(() =>
    normalizeAgendaVisibleHours(null)
  );
  const [clinicSabadoAberto, setClinicSabadoAberto] = useState(false);
  const [clinicSabadoAgendaHours, setClinicSabadoAgendaHours] = useState<
    number[] | null
  >(null);
  const [clinicSlotsExpediente, setClinicSlotsExpediente] = useState<unknown>(
    null
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  /** Menu lateral em desktop (sm+); mobile continua a usar o drawer. */
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [humanQueueCount, setHumanQueueCount] = useState(0);
  const [inboxInitialPhone, setInboxInitialPhone] = useState<string | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const handleWhatsappStatusChange = useCallback(
    (s: string) => setWhatsappConnected(s === "connected"),
    []
  );
  const [nowTick, setNowTick] = useState(() => new Date());
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  /** Abre o modal de confirmação antes de cancelar (substitui `window.confirm`). */
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [removeConfirmAck, setRemoveConfirmAck] = useState(false);
  const [rescheduleRow, setRescheduleRow] = useState<AppointmentRow | null>(null);
  const [access, setAccess] = useState<AccessState | null>(null);
  const locallyModified = useRef(new Set<string>());
  const prevRowsRef = useRef<AppointmentRow[]>([]);
  /** 0 = ainda não houve um load completo; após 1º load finalizado só sincroniza; difs só a partir do 2º. */
  const apptNotifSettledLoadsRef = useRef(0);
  const apptSnapshotRef = useRef<AppointmentSnapshot>(new Map());
  /** Só true após `loadAppointments` terminar — evita snapshot vazio antes de `setListLoading(true)` aplicar. */
  const apptNotifyReadyRef = useRef(false);
  const prevClinicIdForNotifRef = useRef<string | null>(null);
  const agendaNotif = useAgendaNotifications();
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

  const clearProfessionalsOpenIntent = useCallback(() => {
    setProfessionalsOpenIntent(null);
  }, []);

  const goToProfessionalsForExtraHour = useCallback((profissionalNome: string) => {
    setProfessionalsOpenIntent({ focusName: profissionalNome.trim() });
    setSidebarPage("professionals");
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

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

  // Verifica status do WhatsApp para exibir "IA activa" no header.
  useEffect(() => {
    if (access?.kind !== "clinic") return;
    const clinicId = access.clinicId;
    let cancelled = false;
    void fetch(`/api/whatsapp/status?clinicId=${clinicId}`)
      .then((r) => r.json())
      .then((json: { status?: string }) => {
        if (!cancelled) setWhatsappConnected(json.status === "connected");
      })
      .catch(() => {/* ignore */});
    return () => { cancelled = true; };
  }, [access?.kind, access?.kind === "clinic" ? access.clinicId : null]);

  // Limpa inbox só ao mudar de clínica — não em cada refresh (para "Limpar" persistir).
  useEffect(() => {
    if (access?.kind !== "clinic") {
      prevClinicIdForNotifRef.current = null;
      return;
    }
    const id = access.clinicId;
    const prev = prevClinicIdForNotifRef.current;
    if (prev != null && prev !== id) {
      agendaNotif.clearInbox();
    }
    prevClinicIdForNotifRef.current = id;
  }, [access?.kind, access?.kind === "clinic" ? access.clinicId : null, agendaNotif.clearInbox]);

  const loadAppointments = useCallback(async () => {
    if (!supabase) return;
    if (access?.kind !== "clinic") return;
    const clinicId = access.clinicId;
    apptNotifyReadyRef.current = false;
    setListLoading(true);
    setListError(null);

    const apptSelect = (includeGender: boolean) =>
      supabase
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
        professionals ( id, name, specialty, ${
          includeGender ? "gender, " : ""
        }panel_color, avatar_path, avatar_emoji )
      `
        )
        .eq("clinic_id", clinicId)
        .order("starts_at", { ascending: true });

    const prosSelect = (includeGender: boolean) =>
      supabase
        .from("professionals")
        .select(
          includeGender
            ? "id, name, gender, panel_color, cs_profissional_id, is_active, whatsapp"
            : "id, name, panel_color, cs_profissional_id, is_active, whatsapp"
        )
        .eq("clinic_id", clinicId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

    const [{ data, error }, { data: csRaw, error: csErr }, { data: pros }] =
      await Promise.all([
        withProfessionalsGenderFallback((g) => apptSelect(g)),
        supabase.rpc("painel_list_cs_agendamentos", { p_clinic_id: clinicId }),
        withProfessionalsGenderFallback((g) => prosSelect(g)),
      ]);

    setProfRoster(
      (pros ?? []) as {
        id: string;
        name: string;
        gender?: string | null;
        panel_color: string | null;
        cs_profissional_id: string | null;
        is_active: boolean;
        whatsapp: string | null;
      }[]
    );

    if (error) {
      setListError(error.message);
      setRows([]);
      apptNotifyReadyRef.current = true;
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
    apptNotifyReadyRef.current = true;
    setListLoading(false);
  }, [supabase, access]);

  const loadClinicAgendaSettings = useCallback(async () => {
    if (!supabase || access?.kind !== "clinic") return;
    const { data, error } = await supabase
      .from("clinics")
      .select(
        "agenda_visible_hours, slots_expediente, sabado_aberto, sabado_agenda_hours"
      )
      .eq("id", access.clinicId)
      .maybeSingle();
    if (error) return;
    const row = data as {
      agenda_visible_hours?: unknown;
      slots_expediente?: unknown;
      sabado_aberto?: unknown;
      sabado_agenda_hours?: unknown;
    } | null;
    if (row) {
      setClinicAgendaHours(normalizeAgendaVisibleHours(row.agenda_visible_hours));
      setClinicSabadoAberto(
        row.sabado_aberto === true ||
          row.sabado_aberto === "true" ||
          row.sabado_aberto === 1
      );
      setClinicSabadoAgendaHours(normalizeSabadoAgendaHours(row.sabado_agenda_hours));
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

  const clinicAgendaConfig = useMemo<ClinicAgendaWeekendConfig>(
    () => ({
      weekdayHours: clinicAgendaHours,
      sabadoAberto: clinicSabadoAberto,
      sabadoAgendaHours: clinicSabadoAgendaHours,
    }),
    [clinicAgendaHours, clinicSabadoAberto, clinicSabadoAgendaHours]
  );

  const gridHoursForSelectedDay = useMemo(
    () => clinicVisibleHoursForDayKey(dayKey, clinicAgendaConfig),
    [dayKey, clinicAgendaConfig]
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

  const profFilteredRows = useMemo(() => {
    if (!profFilterId) return tabFilteredRows;
    return tabFilteredRows.filter((r) =>
      rowMatchesProfessionalFilter(r, profFilterId, profRoster)
    );
  }, [tabFilteredRows, profFilterId, profRoster]);

  const listDisplayRows = useMemo(
    () =>
      profFilteredRows.filter((r) =>
        matchesLocalDayKey(r.starts_at, dayKey)
      ),
    [profFilteredRows, dayKey]
  );

  const statsDayRows = useMemo(() => {
    let base = rows
      .filter((r) => r.status !== "cancelled")
      .filter((r) => matchesLocalDayKey(r.starts_at, dayKey));
    if (profFilterId) {
      base = base.filter((r) =>
        rowMatchesProfessionalFilter(r, profFilterId, profRoster)
      );
    }
    return base;
  }, [rows, dayKey, profFilterId, profRoster]);

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

  const yesterdayKey = useMemo(
    () => (dayKey ? addDaysToYmd(dayKey, -1) : ""),
    [dayKey]
  );

  const statsYesterday = useMemo(() => {
    let base = rows
      .filter((r) => r.status !== "cancelled")
      .filter((r) =>
        yesterdayKey ? matchesLocalDayKey(r.starts_at, yesterdayKey) : false
      );
    if (profFilterId) {
      base = base.filter((r) =>
        rowMatchesProfessionalFilter(r, profFilterId, profRoster)
      );
    }
    const scheduled = base.filter((r) => r.status === "scheduled");
    const pending = scheduled.filter((r) => awaitsConfirmation(r)).length;
    const confirmedOnDay = scheduled.filter((r) => isClinicConfirmed(r))
      .length;
    return {
      totalScheduled: scheduled.length,
      pending,
      confirmedOnDay,
    };
  }, [rows, yesterdayKey, profFilterId, profRoster]);

  useEffect(() => {
    if (!profFilterId || !profRoster.length) return;
    if (!profRoster.some((p) => p.id === profFilterId)) {
      setProfFilterId(null);
    }
  }, [profFilterId, profRoster]);

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

  const executeRemoveAppointment = useCallback(
    async (id: string) => {
      if (!supabase || access?.kind !== "clinic") return;
      setRowBusy(id);
      setListError(null);
      let error: { message: string; code?: string } | null = null;

      locallyModified.current.add(id);
      const csUuid = csAgendamentoUuidFromPanelId(id);
      if (csUuid) {
        const { data: cancelData, error: e } = await supabase.rpc(
          "painel_cancel_cs_agendamento",
          {
            p_clinic_id: access.clinicId,
            p_cs_agendamento_id: csUuid,
          }
        );
        if (e) {
          error = e;
        } else {
          const rpcErr = painelRpcCancelCsErrorMessage(cancelData);
          if (rpcErr) {
            error = { message: rpcErr };
          } else {
            fireNotifyProfessionalAfterPanelCancel(access.clinicId, cancelData, id);
          }
        }
      } else {
        const { data: upd, error: e } = await supabase
          .from("appointments")
          .update({ status: "cancelled" })
          .eq("id", id)
          .select("id")
          .maybeSingle();
        if (e) error = e;
        else if (!upd) error = { message: "Agendamento não encontrado." };
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

  const removeConfirmRow = useMemo(
    () =>
      removeConfirmId
        ? rows.find((r) => r.id === removeConfirmId) ?? null
        : null,
    [removeConfirmId, rows]
  );

  useEffect(() => {
    if (removeConfirmId) setRemoveConfirmAck(false);
  }, [removeConfirmId]);

  useEffect(() => {
    if (!removeConfirmId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRemoveConfirmId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removeConfirmId]);

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
        .limit(1)
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
      const { data: membership, error: em } = await supabase
        .from("clinic_members")
        .select("clinic_id")
        .eq("user_id", uid)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (em) {
        if (isClinicMembersUnavailableError(em)) {
          setAccess({ kind: "onboarding" });
          return;
        }
        setAccess({ kind: "denied", message: em.message });
        return;
      }
      if (membership?.clinic_id) {
        const { data: c2, error: e2 } = await supabase
          .from("clinics")
          .select("id, name")
          .eq("id", membership.clinic_id)
          .maybeSingle();
        if (cancelled) return;
        if (e2 || !c2?.id) {
          setAccess({
            kind: "denied",
            message: e2?.message ?? "Clínica não encontrada.",
          });
          return;
        }
        setAccess({
          kind: "clinic",
          clinicId: c2.id,
          clinicName: c2.name,
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
    if (!access || access.kind !== "clinic") {
      setCrmSubscription({ loaded: false });
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/clinica/${encodeURIComponent(access.clinicId)}/assinatura`,
        { credentials: "same-origin" }
      );
      const j = (await res.json().catch(() => ({}))) as {
        fields?: {
          tipo_plano?: string;
          plan_tem_crm?: boolean;
          data_expiracao?: string | null;
          ativo?: boolean;
          inadimplente?: boolean;
        };
      };
      if (cancelled) return;
      const f = j.fields;
      if (!f) {
        setCrmSubscription({
          loaded: true,
          hasAccess: false,
          tipo_plano: "mensal",
        });
        return;
      }
      const tipo = typeof f.tipo_plano === "string" ? f.tipo_plano : "teste";
      setCrmSubscription({
        loaded: true,
        hasAccess: hasFullAccess({
          tipo_plano: tipo,
          data_expiracao: f.data_expiracao ?? null,
          ativo: f.ativo !== false,
          inadimplente: !!f.inadimplente,
          plan_tem_crm:
            f.plan_tem_crm === true || String(f.plan_tem_crm) === "true",
        }),
        tipo_plano: tipo,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [access]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("crm_upgrade") === "1") {
      setCrmUpgradeOpen(true);
      window.history.replaceState({}, "", "/painel");
    }
  }, []);

  const openCrmOrUpgrade = useCallback(() => {
    if (access?.kind !== "clinic") return;
    if (crmSubscription.loaded && crmSubscription.hasAccess) {
      router.push(`/clinica/${access.clinicId}/crm`);
    } else {
      setCrmUpgradeOpen(true);
    }
  }, [access, crmSubscription, router]);

  const crmBadgeText =
    !crmSubscription.loaded || access?.kind !== "clinic"
      ? "…"
      : !crmSubscription.hasAccess
        ? "Upgrade"
        : crmSubscription.tipo_plano === "enterprise"
          ? "Enterprise"
          : crmSubscription.hasAccess && crmSubscription.tipo_plano !== "teste"
            ? "CRM"
            : "Trial";

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

  // Realtime + poll para o badge "WhatsApp humano"
  useEffect(() => {
    if (!supabase || access?.kind !== "clinic") return;
    const clinicId = access.clinicId;
    const channel = supabase
      .channel(`human_queue_badge_${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_sessions",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => { void refreshHumanQueue(); }
      )
      .subscribe();
    const timer = setInterval(() => { void refreshHumanQueue(); }, 20000);
    return () => {
      void supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [supabase, access, refreshHumanQueue]);

  const clinicNotifKey = access?.kind === "clinic" ? access.clinicId : null;
  useEffect(() => {
    apptNotifSettledLoadsRef.current = 0;
    apptSnapshotRef.current = new Map();
    apptNotifyReadyRef.current = false;
  }, [clinicNotifKey]);

  useEffect(() => {
    if (!agendaNotif.hydrated) return;
    if (listLoading) return;
    if (access?.kind !== "clinic") return;
    if (!apptNotifyReadyRef.current) return;

    const clinicId = access.clinicId;
    const rosterForNotify = profRoster.map((p) => ({
      id: p.id,
      name: p.name,
      cs_profissional_id: p.cs_profissional_id,
      whatsapp: p.whatsapp,
    }));

    const snap = buildAppointmentSnapshot(rows);
    if (apptNotifSettledLoadsRef.current === 0) {
      apptSnapshotRef.current = snap;
      apptNotifSettledLoadsRef.current = 1;
      return;
    }

    const prev = apptSnapshotRef.current;
    for (const [id, cur] of snap) {
      if (locallyModified.current.has(id)) continue;
      const old = prev.get(id);
      const row = rows.find((x) => x.id === id);
      if (!row) continue;
      if (!old) {
        agendaNotif.addNotification(notificationFromRow(row, "agendamento"));
        fireNotifyProfessionalFromAgendaDiff({
          clinicId,
          row,
          kind: "agendamento",
          roster: rosterForNotify,
        });
      } else {
        if (old.status !== "cancelled" && cur.status === "cancelled") {
          agendaNotif.addNotification(notificationFromRow(row, "cancelamento"));
          fireNotifyProfessionalFromAgendaDiff({
            clinicId,
            row,
            kind: "cancelamento",
            roster: rosterForNotify,
          });
        } else if (
          apptStartsAtChanged(old.starts_at, cur.starts_at) &&
          cur.status !== "cancelled" &&
          old.status !== "cancelled"
        ) {
          agendaNotif.addNotification(
            notificationFromRow(row, "reagendamento", {
              prevStartsAt: old.starts_at,
            })
          );
          fireNotifyProfessionalFromAgendaDiff({
            clinicId,
            row,
            kind: "reagendamento",
            roster: rosterForNotify,
            prevStartsAt: old.starts_at,
          });
        }
      }
    }

    apptSnapshotRef.current = snap;
  }, [
    rows,
    listLoading,
    access,
    profRoster,
    agendaNotif.hydrated,
    agendaNotif.addNotification,
  ]);

  useEffect(() => {
    if (!supabase || access?.kind !== "clinic") return;
    const clinicId = access.clinicId;

    const channel = supabase
      .channel(`appt-notif:${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "appointments",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; source?: string | null };
          if (locallyModified.current.has(row.id)) return;
          if (row.source === "painel") return;
          void loadAppointments();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "appointments",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; status?: string; starts_at?: string };
          if (locallyModified.current.has(row.id)) return;
          const prev = prevRowsRef.current.find((r) => r.id === row.id);
          if (row.status === "cancelled" && prev?.status !== "cancelled") {
            void loadAppointments();
            return;
          }
          if (prev && row.starts_at && prev.starts_at !== row.starts_at) {
            void loadAppointments();
            return;
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "cs_agendamentos",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string };
          if (row.id && locallyModified.current.has(`cs:${row.id}`)) return;
          void loadAppointments();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "cs_agendamentos",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string };
          if (row.id && locallyModified.current.has(`cs:${row.id}`)) return;
          void loadAppointments();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, access, loadAppointments]);

  useEffect(() => {
    if (!supabase || access?.kind !== "clinic") return;
    const tick = window.setInterval(() => {
      void loadAppointments();
    }, 25000);
    return () => clearInterval(tick);
  }, [supabase, access?.kind, access?.kind === "clinic" ? access.clinicId : null, loadAppointments]);

  /** Volta ao separador / foco: sincroniza logo (Realtime pode falhar se `cs_agendamentos` não estiver na publicação). */
  useEffect(() => {
    if (!supabase || access?.kind !== "clinic") return;
    let debounce: number | undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        void loadAppointments();
      }, 600);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(debounce);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
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

  const focusAppointmentFromNotif = useCallback(
    (appointmentId: string, startsAtIso: string) => {
      setSidebarPage("dashboard");
      setMobileMenuOpen(false);
      setViewMode("list");
      setProfFilterId(null);
      setListFilter("all");
      setDayKey(localYmdFromIso(startsAtIso));
      window.setTimeout(() => {
        document
          .getElementById(`appointment-card-${appointmentId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 420);
    },
    []
  );

  async function handleSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
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
      <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center text-sm text-[var(--text-muted)]">
        <p>A abrir a página de login…</p>
      </div>
    );
  }

  if (!access || access.kind === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg)] px-4 text-[var(--text-muted)]">
        <p className="text-sm">A carregar permissões…</p>
      </div>
    );
  }

  if (access.kind === "onboarding") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg)] px-4 text-[var(--text-muted)]">
        <p className="text-sm">A abrir o cadastro da clínica…</p>
      </div>
    );
  }

  if (access.kind === "denied") {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-display text-xl font-semibold text-[var(--text)]">
          Sem acesso ao painel
        </h1>
        <p className="mt-3 text-sm text-[var(--text-muted)]">{access.message}</p>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="mt-6 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-strong)]"
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
    "rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-[var(--primary-strong)]";
  const filterIdle =
    "rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm font-medium text-[var(--text-muted)] shadow-sm transition-all duration-200 hover:border-[var(--border)] hover:bg-[var(--surface-soft)]";
  const viewToggleActive =
    "rounded-lg bg-[var(--primary)] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors";
  const viewToggleIdle =
    "rounded-lg px-3.5 py-2 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-soft)]";
  const sidebarNavActive =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[var(--primary)] bg-[var(--sidebar-active)] shadow-sm transition-colors";
  const sidebarNavIdle =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--primary)]";
  function sidebarNavClass(page: SidebarPage) {
    return sidebarPage === page ? sidebarNavActive : sidebarNavIdle;
  }
  function mobileNavRowClass(page: SidebarPage) {
    return `flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors ${
      sidebarPage === page
        ? "bg-[var(--sidebar-active)] font-semibold text-[var(--primary)]"
        : "font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)]"
    }`;
  }

  return (
    <div className="painel-root flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)] transition-colors duration-300 sm:flex-row">
      {crmUpgradeOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="crm-upgrade-title"
        >
          <div className="max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <h2 id="crm-upgrade-title" className="font-display text-lg font-semibold text-[var(--text)]">
              CRM disponível no Enterprise ou no teste activo
            </h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Entre em contato com nosso suporte para ativar seu plano e liberar o CRM.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white"
                onClick={() => {
                  window.open(
                    getSupportWhatsAppActivatePlanUrl(),
                    "_blank",
                    "noopener,noreferrer"
                  );
                  setCrmUpgradeOpen(false);
                }}
              >
                Falar com suporte
              </button>
              <button
                type="button"
                className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-medium text-[var(--text)]"
                onClick={() => setCrmUpgradeOpen(false)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {supabase ? (
        <>
          <ScheduleAppointmentModal
            open={scheduleOpen}
            onClose={() => setScheduleOpen(false)}
            onSuccess={() => void loadAppointments()}
            supabase={supabase}
            clinicId={access.clinicId}
            clinicAgendaConfig={clinicAgendaConfig}
          />
          <RescheduleAppointmentModal
            open={rescheduleRow != null}
            onClose={() => setRescheduleRow(null)}
            onSuccess={() => void loadAppointments()}
            supabase={supabase}
            clinicId={access.clinicId}
            clinicAgendaConfig={clinicAgendaConfig}
            appointment={rescheduleRow}
            profRoster={profRoster}
            rowBusy={rowBusy}
            setRowBusy={setRowBusy}
          />
          <ProceduresManagerModal
            open={proceduresOpen}
            onClose={() => setProceduresOpen(false)}
            supabase={supabase}
            clinicId={access.clinicId}
          />
        </>
      ) : null}

      {/* Sidebar desktop: wrapper não usa overflow-hidden para o puxador na borda */}
      {desktopSidebarOpen ? (
        <div className="relative z-20 hidden h-full w-[280px] shrink-0 sm:block">
          <aside
            id="painel-sidebar-desktop"
            className="flex h-full w-full flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--sidebar-bg)] shadow-sm transition-colors duration-300"
          >
        {/* Logo */}
        <button
          type="button"
          onClick={() => setSidebarPage("dashboard")}
          className="flex w-full items-center gap-2.5 border-b border-[var(--border)] px-5 py-5 text-left transition-colors hover:bg-[var(--surface-soft)]"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2v2H8z"/></svg>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight text-[var(--text)]">{headerClinicName}</p>
            <p className="text-[10px] text-[var(--text-muted)]">Painel</p>
          </div>
        </button>
        {/* New appointment button */}
        <div className="px-3 pt-4 pb-2">
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[var(--primary-strong)] hover:shadow-md"
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
            onClick={() => setSidebarPage("clinic-profile")}
            className={sidebarNavClass("clinic-profile")}
            aria-label="Clínica / Perfil"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Clínica / Perfil
          </button>
          <button
            type="button"
            onClick={() => setSidebarPage("slots")}
            className={sidebarNavClass("slots")}
            aria-label="Agendamentos"
          >
            <span className="shrink-0 text-[1.05rem] leading-none" aria-hidden>
              🩺
            </span>
            <span className="min-w-0 flex-1 whitespace-nowrap text-left">
              Agendamentos
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
          <button type="button" onClick={() => setSidebarPage("whatsapp-inbox")} className={sidebarNavClass("whatsapp-inbox")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h8M8 14h5"/></svg>
            Inbox WhatsApp
          </button>
          <button type="button" onClick={() => setSidebarPage("cs-clientes")} className={sidebarNavClass("cs-clientes")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Clientes
          </button>
          <button type="button" onClick={() => setSidebarPage("agent")} className={sidebarNavClass("agent")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 15h.01M12 15h.01M16 15h.01"/></svg>
            Agente IA
          </button>
          <button type="button" onClick={() => setSidebarPage("whatsapp-connect")} className={sidebarNavClass("whatsapp-connect")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.12.55 4.18 1.6 6L0 24l6.18-1.62A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.19-1.25-6.21-3.48-8.52ZM12 22c-1.85 0-3.66-.5-5.23-1.44l-.37-.22-3.88 1.02 1.04-3.8-.24-.38A9.95 9.95 0 0 1 2 12C2 6.47 6.47 2 12 2a9.95 9.95 0 0 1 7.07 2.93A9.95 9.95 0 0 1 22 12c0 5.53-4.47 10-10 10Z"/></svg>
            Conectar WhatsApp
          </button>
          <button type="button" onClick={() => setSidebarPage("clinic-subscription")} className={sidebarNavClass("clinic-subscription")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="M8 2v4M16 2v4"/></svg>
            Assinatura e acesso
          </button>
          <button
            type="button"
            onClick={() => openCrmOrUpgrade()}
            className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${sidebarNavIdle}`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span className="min-w-0 flex-1 text-left">CRM</span>
            <span className="rounded-md bg-[var(--primary)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--primary)]">
              {crmBadgeText}
            </span>
          </button>
          <button type="button" onClick={() => setSidebarPage("report")} className={sidebarNavClass("report")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Relatório
          </button>
        </nav>
        {/* Footer */}
        <div className="px-3 py-3 space-y-0.5">
          <p className="truncate px-3 py-1 text-[11px] text-[var(--text-muted)]">{session.user.email}</p>
          <button type="button" onClick={() => void handleSignOut()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--primary)]">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            Sair
          </button>
        </div>
          </aside>
          <button
            type="button"
            onClick={() => setDesktopSidebarOpen(false)}
            className="group absolute top-1/2 left-full z-30 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--sidebar-bg)] text-[var(--text-muted)] shadow-md transition-all duration-200 hover:scale-110 hover:border-[var(--primary)] hover:text-[var(--primary)] hover:shadow-lg"
            title="Recolher menu"
            aria-label="Recolher menu lateral"
            aria-expanded={true}
            aria-controls="painel-sidebar-desktop"
          >
            <IconChevronLeft className="shrink-0 [&>path]:stroke-[2.5]" />
          </button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {!desktopSidebarOpen ? (
        <button
          type="button"
          onClick={() => setDesktopSidebarOpen(true)}
          className="absolute top-1/2 left-0 z-30 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] shadow-md transition-all duration-200 hover:scale-110 hover:border-[var(--primary)] hover:text-[var(--primary)] hover:shadow-lg sm:flex"
          title="Abrir menu"
          aria-label="Abrir menu lateral"
          aria-controls="painel-sidebar-desktop"
          aria-expanded={false}
        >
          <IconChevronRight className="shrink-0 [&>path]:stroke-[2.5]" />
        </button>
      ) : null}
      <NotificationToastStack
        toasts={agendaNotif.toasts}
        dismissToast={agendaNotif.dismissToast}
      />
      {/* Status bar desktop — fora do scroll, sempre fixo no topo */}
      <div className="hidden sm:flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--bg)]/95 px-7 py-2 backdrop-blur-sm text-xs text-[var(--text-muted)]">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            Sistema online
          </span>
          <span>|</span>
          <span>
            Profissionais activos:{" "}
            <strong className="text-[var(--text)]">{profRoster.filter((p) => p.is_active !== false).length}</strong>
          </span>
          {whatsappConnected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/15 px-2 py-0.5 text-[11px] font-semibold text-teal-400">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
              IA activa
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarPage("alerts")}
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
            title="Alertas"
            aria-label="Abrir alertas"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {agendaNotif.unreadCount > 0 ? (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white leading-none">
                {agendaNotif.unreadCount > 99 ? "99+" : agendaNotif.unreadCount}
              </span>
            ) : null}
          </button>
          <ThemeToggle size="sm" />
          <time className="tabular-nums text-[var(--text)]" dateTime={nowTick.toISOString()}>
            {new Intl.DateTimeFormat("pt-BR", {
              weekday: "short",
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }).format(nowTick)}
          </time>
        </div>
      </div>
      <header className={`sticky top-0 z-30 shrink-0 border-b border-[var(--border)] bg-[var(--surface)]/85 backdrop-blur-md sm:hidden ${mobileMenuOpen ? "z-[60]" : "z-30"}`}>
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface)] shadow-sm text-[var(--text)] transition-colors hover:bg-[var(--surface-soft)]"
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
            <p className="truncate text-sm font-bold text-[var(--text)]">{headerClinicName}</p>
            <p className="text-[10px] text-[var(--text-muted)]">Painel de agendamentos</p>
          </button>
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-white shadow-sm"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </header>

      {mobileMenuOpen ? (
        <>
          <button
            type="button"
            className="agenda-drawer-backdrop fixed inset-0 z-40 bg-[var(--text)]/25 backdrop-blur-[2px] sm:hidden"
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
            <div className="flex h-full flex-col overflow-hidden bg-[var(--surface)] shadow-[4px_0_32px_rgba(0,0,0,0.1)]">
              <button
                type="button"
                className="flex w-full items-center gap-2.5 border-b border-[var(--border)] px-5 py-5 text-left hover:bg-[var(--surface-soft)]"
                onClick={() => goToSidebarPageAfterMobileMenuClose("dashboard")}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2v2H8z"/></svg>
                </div>
                <div className="min-w-0">
                  <p id="painel-menu-mobile-title" className="truncate text-sm font-bold text-[var(--text)]">{headerClinicName}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Painel · toque para o Dashboard</p>
                </div>
              </button>
              {/* New appointment */}
              <div className="px-4 pt-4 pb-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white"
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
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>
                  Dashboard
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("professionals")}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("professionals")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
                  Profissionais
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("clinic-profile")}
                  aria-label="Clínica / Perfil"
                  onClick={() => goToSidebarPageAfterMobileMenuClose("clinic-profile")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11l5 5v9a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  </span>
                  <span className="min-w-0 flex-1 whitespace-nowrap text-left">
                    Clínica / Perfil
                  </span>
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("slots")}
                  aria-label="Agendamentos"
                  onClick={() => goToSidebarPageAfterMobileMenuClose("slots")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-lg leading-none">
                    🩺
                  </span>
                  <span className="min-w-0 flex-1 whitespace-nowrap text-left">
                    Agendamentos
                  </span>
                </button>
                <button
                  type="button"
                  className={`relative ${mobileNavRowClass("whatsapp-human")}`}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("whatsapp-human")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>
                  <span className="flex-1 text-left">WhatsApp humano</span>
                  {humanQueueCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#c2410c] px-1 text-[10px] font-bold text-white">{humanQueueCount > 99 ? "99+" : humanQueueCount}</span>}
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("whatsapp-inbox")}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("whatsapp-inbox")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h8M8 14h5"/></svg></span>
                  Inbox WhatsApp
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("cs-clientes")}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("cs-clientes")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </span>
                  Clientes
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("agent")}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("agent")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 15h.01M12 15h.01M16 15h.01"/></svg></span>
                  Agente IA
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("whatsapp-connect")}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("whatsapp-connect")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.12.55 4.18 1.6 6L0 24l6.18-1.62A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.19-1.25-6.21-3.48-8.52ZM12 22c-1.85 0-3.66-.5-5.23-1.44l-.37-.22-3.88 1.02 1.04-3.8-.24-.38A9.95 9.95 0 0 1 2 12C2 6.47 6.47 2 12 2a9.95 9.95 0 0 1 7.07 2.93A9.95 9.95 0 0 1 22 12c0 5.53-4.47 10-10 10Z"/></svg></span>
                  Conectar WhatsApp
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("clinic-subscription")}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("clinic-subscription")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="M8 2v4M16 2v4"/></svg></span>
                  Assinatura e acesso
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("crm")}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openCrmOrUpgrade();
                  }}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4" />
                      <circle cx="9" cy="7" r="4" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1 text-left">CRM</span>
                  <span className="rounded-md bg-[var(--primary)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--primary)]">
                    {crmBadgeText}
                  </span>
                </button>
                <button
                  type="button"
                  className={mobileNavRowClass("report")}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("report")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span>
                  Relatório
                </button>
                <button
                  type="button"
                  className={`relative ${mobileNavRowClass("alerts")}`}
                  onClick={() => goToSidebarPageAfterMobileMenuClose("alerts")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--sidebar-active)] text-[var(--primary)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </span>
                  <span className="flex-1 text-left">Alertas</span>
                  {agendaNotif.unreadCount > 0 ? (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {agendaNotif.unreadCount > 99 ? "99+" : agendaNotif.unreadCount}
                    </span>
                  ) : null}
                </button>
              </nav>
              <div className="flex shrink-0 justify-center border-b border-[var(--border)] px-3 py-2.5">
                <ThemeToggle />
              </div>
              {/* Footer */}
              <div className="px-3 py-3 space-y-0.5">
                <p className="truncate px-3 py-1 text-[11px] text-[var(--text-muted)]">{session.user.email}</p>
                <button type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)]" onClick={() => { setMobileMenuOpen(false); void handleSignOut(); }}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-soft)] text-[var(--text-muted)]"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg></span>
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
          supabase && access.kind === "clinic" ? (
            <PainelDashboard
              clinicId={access.clinicId}
              supabase={supabase}
              rows={rows}
              listLoading={listLoading}
              listError={listError}
              listFilter={listFilter}
              setListFilter={setListFilter}
              profFilterId={profFilterId}
              setProfFilterId={setProfFilterId}
              profRoster={profRoster}
              viewMode={viewMode}
              setViewMode={setViewMode}
              dayKey={dayKey}
              setDayKey={setDayKey}
              todayLabel={todayLabel}
              setTodayLabel={setTodayLabel}
              selectedDayLabel={selectedDayLabel}
              stats={stats}
              statsYesterday={statsYesterday}
              loadAppointments={loadAppointments}
              calendarFocusDate={calendarFocusDate}
              calendarSlotBounds={calendarSlotBounds}
              listDisplayRows={listDisplayRows}
              profFilteredRows={profFilteredRows}
              rowBusy={rowBusy}
              onConfirmAppointment={(id) => void confirmAppointment(id)}
              onRemoveAppointment={(id) => setRemoveConfirmId(id)}
              onOpenReschedule={(row) => setRescheduleRow(row)}
              filterActive={filterActive}
              filterIdle={filterIdle}
              viewToggleActive={viewToggleActive}
              viewToggleIdle={viewToggleIdle}
              gridVisibleHours={gridHoursForSelectedDay}
            />
          ) : null
        ) : supabase ? (
          <div className="w-full min-w-0">
            {sidebarPage === "professionals" ? (
              <ProfessionalsManagerModal
                presentation="panel"
                open
                onClose={() => setSidebarPage("dashboard")}
                supabase={supabase}
                clinicId={access.clinicId}
                agendaDayKey={dayKey}
                focusProfessionalName={professionalsOpenIntent?.focusName ?? null}
                onFocusProfessionalConsumed={clearProfessionalsOpenIntent}
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
                clinicAgendaConfig={clinicAgendaConfig}
                clinicSlotsExpediente={clinicSlotsExpediente}
                onGoToProfessionalsExtraHour={goToProfessionalsForExtraHour}
                onGoToClinicAgendaSettings={() => setSidebarPage("clinic-hours")}
              />
            ) : null}
            {sidebarPage === "clinic-profile" ? (
              <ClinicProfilePanel
                presentation="panel"
                open
                onClose={() => setSidebarPage("dashboard")}
                supabase={supabase}
                clinicId={access.clinicId}
              />
            ) : null}
            {sidebarPage === "clinic-hours" ? (
              <ClinicAgendaHoursModal
                presentation="panel"
                open
                onClose={() => setSidebarPage("dashboard")}
                supabase={supabase}
                clinicId={access.clinicId}
                onSaved={(p) => {
                  setClinicAgendaHours(p.agenda_visible_hours);
                  setClinicSabadoAberto(p.sabado_aberto);
                  setClinicSabadoAgendaHours(p.sabado_agenda_hours);
                }}
              />
            ) : null}
            {sidebarPage === "whatsapp-human" ? (
              <WhatsappHumanModal
                presentation="panel"
                open
                onClose={() => setSidebarPage("dashboard")}
                supabase={supabase}
                clinicId={access.clinicId}
                onClaimed={(phone) => {
                  setInboxInitialPhone(phone);
                  setSidebarPage("whatsapp-inbox");
                  void refreshHumanQueue();
                }}
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
            {sidebarPage === "whatsapp-inbox" ? (
              <div className="flex h-[calc(100vh-120px)] min-h-0 w-full p-2">
                <WhatsappInbox
                  supabase={supabase}
                  clinicId={access.clinicId}
                  initialPhone={inboxInitialPhone ?? undefined}
                  onInitialPhoneConsumed={() => setInboxInitialPhone(null)}
                />
              </div>
            ) : null}
            {sidebarPage === "cs-clientes" ? (
              <div className="flex h-[calc(100vh-120px)] min-h-0 w-full overflow-hidden p-4">
                <PainelClientesCs supabase={supabase} clinicId={access.clinicId} />
              </div>
            ) : null}
            {sidebarPage === "whatsapp-connect" ? (
              <ConectarWhatsapp
                clinicId={access.clinicId}
                supabase={supabase}
                onStatusChange={handleWhatsappStatusChange}
              />
            ) : null}
            {sidebarPage === "clinic-subscription" ? (
              <ClinicSubscriptionPanel clinicId={access.clinicId} />
            ) : null}
            {sidebarPage === "report" ? (
              <ReportModal
                presentation="panel"
                open
                onClose={() => setSidebarPage("dashboard")}
                rows={rows}
              />
            ) : null}
            {sidebarPage === "alerts" ? (
              <NotificationAlertsPage
                onBack={() => setSidebarPage("dashboard")}
                prefs={agendaNotif.prefs}
                updatePrefs={agendaNotif.updatePrefs}
                inbox={agendaNotif.inbox}
                markAllRead={agendaNotif.markAllRead}
                markOneRead={agendaNotif.markOneRead}
                clearInbox={agendaNotif.clearInbox}
                onNavigateAppointment={focusAppointmentFromNotif}
                playTestSound={agendaNotif.playTestSound}
                onFirstInteraction={agendaNotif.onFirstBellInteraction}
              />
            ) : null}
          </div>
        ) : null}
        </div>

        {removeConfirmId ? (
          <div
            className="fixed inset-0 z-[220] flex items-center justify-center p-4"
            role="presentation"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
              aria-label="Fechar"
              onClick={() => setRemoveConfirmId(null)}
            />
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="remove-appt-dialog-title"
              aria-describedby="remove-appt-dialog-desc"
              className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
            >
              <h2
                id="remove-appt-dialog-title"
                className="font-display text-lg font-semibold text-[var(--text)]"
              >
                Cancelar agendamento?
              </h2>
              <p
                id="remove-appt-dialog-desc"
                className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]"
              >
                {removeConfirmRow ? (
                  <>
                    <span className="font-medium text-[var(--text)]">
                      {one(removeConfirmRow.patients)?.name?.trim() ||
                        "Este agendamento"}
                    </span>
                    {" — "}
                  </>
                ) : null}
                Deseja realmente excluir ou cancelar este agendamento? Esta ação
                não pode ser desfeita.
              </p>
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3.5 text-sm leading-snug text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={removeConfirmAck}
                  onChange={(e) => setRemoveConfirmAck(e.target.checked)}
                  disabled={rowBusy === removeConfirmId}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border)] accent-[var(--primary)] disabled:opacity-50"
                />
                <span>
                  Confirmo que quero cancelar este agendamento e sei que não é
                  possível desfazer.
                </span>
              </label>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={rowBusy === removeConfirmId}
                  onClick={() => setRemoveConfirmId(null)}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)] disabled:opacity-50"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={
                    !removeConfirmAck || rowBusy === removeConfirmId
                  }
                  onClick={() => {
                    const id = removeConfirmId;
                    setRemoveConfirmId(null);
                    if (id) void executeRemoveAppointment(id);
                  }}
                  className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {rowBusy === removeConfirmId
                    ? "A cancelar…"
                    : "Sim, cancelar"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
      </div>

    </div>
  );
}
