"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDaysToYmd,
  formatLocalYmd,
  isYmdToday,
  parseLocalYmd,
} from "@/lib/local-day";
import { professionalAvatarPublicUrl } from "@/lib/professional-avatar";
import { resolveProfessionalCardStyle } from "@/lib/professional-palette";
import { ProfessionalAvatar } from "@/components/professional-avatar";
import { parseSlotHour } from "@/lib/slots-expediente";

const DISPLAY_HOUR_START = 7;
const DISPLAY_HOUR_END = 19;

export type CsSlotRow = {
  horario_id: string;
  profissional_id: string;
  profissional_nome: string;
  especialidade: string | null;
  /** Preenchido quando há agendamento ativo neste horário (nome do serviço / snapshot). */
  nome_procedimento: string | null;
  data: string;
  horario: string;
  disponivel: boolean;
  /** Só quando `disponivel` é false: ocupado por agendamento ativo vs bloqueio manual no painel. */
  indisponivel_por: "cliente" | "medico" | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  clinicId: string;
  /** YYYY-MM-DD — dia inicial ao abrir (sincroniza com o painel) */
  dayKey: string;
  /** Quando hoje já não tem vagas úteis, avança o dia do painel (ex.: sábado à noite → segunda). */
  onAutoAdvanceDay?: (ymd: string) => void;
  /** Atualiza o dia do painel quando o utilizador muda a data dentro deste modal. */
  onDayKeyChange?: (ymd: string) => void;
  /** Horas 6–22 habilitadas globalmente pela clínica (`clinics.agenda_visible_hours`) — única grade oficial desta tela. */
  clinicVisibleHours: number[];
  /** Reservado (ex.: compatibilidade); rótulos e grelha usam só `clinicVisibleHours`. */
  clinicSlotsExpediente?: unknown;
  presentation?: "modal" | "panel";
};

function parseIndisponivelPorApi(o: Record<string, unknown>): "cliente" | "medico" | null {
  const p = o.indisponivel_por;
  if (p === "cliente") return "cliente";
  if (p === "medico") return "medico";
  return null;
}

/**
 * Monta o estado de UI alinhado à regra de negócio:
 * - DISPONÍVEL por defeito na grade da clínica.
 * - COM CLIENTE só com motivo explícito (indisponivel_por ou nome de procedimento / reserva).
 * - BLOQUEADO só com `bloqueio_manual` explícito verdadeiro (ou, sem essa chave, indisponivel_por === "medico").
 * Fora COM CLIENTE e BLOQUEADO manual, a célula é sempre DISPONÍVEL — não usar a coluna `disponivel`
 *   (seed/expediente legado punha false sem ser bloqueio do médico).
 */
function parseSlots(raw: unknown): CsSlotRow[] {
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
  return v.map((item) => {
    const o = item as Record<string, unknown>;
    const nomeProcedimento =
      o.nome_procedimento == null ||
      o.nome_procedimento === "" ||
      String(o.nome_procedimento).trim() === ""
        ? null
        : String(o.nome_procedimento).trim();

    const por = parseIndisponivelPorApi(o);
    const comCliente = por === "cliente" || Boolean(nomeProcedimento);
    /**
     * BLOQUEADO só com flag explícita na BD. Sem chave `bloqueio_manual` (RPC velho), cai no fallback
     * indisponivel_por === "medico". Ignorar `disponivel` na coluna quando não há cliente nem bloqueio
     * manual — o seed e dados legados usam disponivel=false para «fora do expediente» sem ser bloqueio.
     */
    const hasBmKey = "bloqueio_manual" in o && o.bloqueio_manual != null;
    const bloqueioManual = hasBmKey
      ? o.bloqueio_manual === true ||
        o.bloqueio_manual === 1 ||
        String(o.bloqueio_manual).toLowerCase() === "true"
      : por === "medico";

    let disponivel: boolean;
    let indisponivel_por: CsSlotRow["indisponivel_por"];
    if (comCliente) {
      disponivel = false;
      indisponivel_por = "cliente";
    } else if (bloqueioManual) {
      disponivel = false;
      indisponivel_por = "medico";
    } else {
      disponivel = true;
      indisponivel_por = null;
    }

    return {
      horario_id: String(o.horario_id ?? ""),
      profissional_id: String(o.profissional_id ?? ""),
      profissional_nome: String(o.profissional_nome ?? ""),
      especialidade:
        o.especialidade == null || o.especialidade === ""
          ? null
          : String(o.especialidade),
      nome_procedimento: nomeProcedimento,
      data: String(o.data ?? ""),
      horario: String(o.horario ?? ""),
      disponivel,
      indisponivel_por,
    } satisfies CsSlotRow;
  });
}

const MAX_DAYS_SCAN = 21;

function uniqueProceduresFromSlots(slots: CsSlotRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of slots) {
    const n = s.nome_procedimento?.trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function ProfSectionHeader({
  profId,
  name,
  specialty,
  photoUrl,
  emoji,
}: {
  profId: string;
  name: string;
  specialty: string | null;
  photoUrl?: string | null;
  emoji?: string | null;
}) {
  const panelColor = resolveProfessionalCardStyle(null, profId).accent;
  return (
    <div className="flex items-start gap-3">
      <ProfessionalAvatar
        name={name}
        photoUrl={photoUrl}
        emoji={emoji}
        panelColor={panelColor}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold text-[var(--text)]">{name}</h3>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          {specialty?.trim() || "Profissional"}
        </p>
      </div>
    </div>
  );
}

function SlotsLegend({ className = "" }: { className?: string }) {
  const items: { dot: string; label: string; title: string }[] = [
    { dot: "bg-teal-950 ring-1 ring-teal-700/80", label: "Livre", title: "Disponível" },
    { dot: "bg-teal-400 ring-1 ring-teal-300/90", label: "Agendado", title: "Com reserva" },
    { dot: "bg-orange-500 ring-1 ring-orange-400/90", label: "Agora", title: "Em curso nesta hora" },
    { dot: "bg-red-950 ring-1 ring-red-800/90", label: "Bloq.", title: "Bloqueado manualmente" },
    { dot: "bg-zinc-600 ring-1 ring-zinc-500/80", label: "Fora", title: "Fora da configuração da clínica" },
  ];
  return (
    <div
      className={"flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-[var(--text-muted)] " + className}
      role="list"
      aria-label="Legenda da grelha"
    >
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5" role="listitem" title={it.title}>
          <span className={"h-2.5 w-2.5 shrink-0 rounded-full " + it.dot} aria-hidden />
          <span>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

export function SlotsManagerModal({
  open,
  onClose,
  supabase,
  clinicId,
  dayKey,
  onAutoAdvanceDay,
  onDayKeyChange,
  clinicVisibleHours,
  clinicSlotsExpediente: _clinicSlotsExpediente,
  presentation = "modal",
}: Props) {
  void _clinicSlotsExpediente;
  const [rows, setRows] = useState<CsSlotRow[]>([]);
  const [profAvatarMap, setProfAvatarMap] = useState<Map<string, { path: string | null; emoji: string | null }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Dia selecionado neste modal (pode diferir do painel até sincronizar). */
  const [activeDayKey, setActiveDayKey] = useState("");
  /** Dia efetivamente carregado (scan “hoje” pode saltar para o próximo dia útil). */
  const [viewDayKey, setViewDayKey] = useState<string | null>(null);
  /** Mobile (< sm): null = todos; id = filtro por profissional (select). */
  const [mobileProfId, setMobileProfId] = useState<string | null>(null);
  /** Desktop: filtrar um único profissional na vista ("" = todos). */
  const [desktopProfFilter, setDesktopProfFilter] = useState("");
  const [layoutWide, setLayoutWide] = useState(false);
  const [, setClockTick] = useState(0);

  // Modal de confirmação (substituí window.confirm)
  const [confirmSlot, setConfirmSlot] = useState<CsSlotRow | null>(null);
  const [confirmAppt, setConfirmAppt] = useState<{
    id: string;
    patientName: string | null;
    phone: string | null;
    serviceName: string | null;
    source: string | null;
    startsAt: string;
    endsAt: string;
  } | null>(null);
  const [confirmFetching, setConfirmFetching] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmDone, setConfirmDone] = useState(false);
  const [confirmingLiberar, setConfirmingLiberar] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setClockTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Busca avatares dos profissionais quando as rows carregam.
  // Faz match por nome normalizado pois cs_profissional_id pode não estar preenchido.
  useEffect(() => {
    if (!rows.length || !clinicId) return;
    const profEntries = [...new Map(rows.map((r) => [r.profissional_id, r.profissional_nome])).entries()];
    if (!profEntries.length) return;

    void supabase
      .from("professionals")
      .select("name, avatar_path, avatar_emoji")
      .eq("clinic_id", clinicId)
      .then(({ data }) => {
        if (!data) return;
        // Prioriza registros que já têm avatar
        const sorted = [...data].sort((a, b) => {
          const aHas = !!((a as { avatar_emoji?: string | null }).avatar_emoji || (a as { avatar_path?: string | null }).avatar_path);
          const bHas = !!((b as { avatar_emoji?: string | null }).avatar_emoji || (b as { avatar_path?: string | null }).avatar_path);
          return Number(bHas) - Number(aHas);
        });
        const normalize = (s: string) =>
          s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
        const map = new Map<string, { path: string | null; emoji: string | null }>();
        for (const [profId, profNome] of profEntries) {
          const normNome = normalize(profNome);
          const match = sorted.find((p) => normalize((p as { name: string }).name) === normNome);
          if (match) {
            map.set(profId, {
              path: (match as { avatar_path?: string | null }).avatar_path ?? null,
              emoji: (match as { avatar_emoji?: string | null }).avatar_emoji ?? null,
            });
          }
        }
        setProfAvatarMap(map);
      });
  }, [rows, supabase, clinicId]);

  useEffect(() => {
    const q = window.matchMedia("(min-width: 640px)");
    const apply = () => setLayoutWide(q.matches);
    apply();
    q.addEventListener("change", apply);
    return () => q.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!open) {
      setViewDayKey(null);
      setMobileProfId(null);
      setDesktopProfFilter("");
      return;
    }
    if (dayKey) setActiveDayKey(dayKey);
  }, [open, dayKey]);

  useEffect(() => {
    setMobileProfId(null);
  }, [activeDayKey]);

  const labelKey = viewDayKey ?? activeDayKey;
  const dateLabel = useMemo(() => {
    if (!labelKey) return "";
    try {
      return new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(parseLocalYmd(labelKey));
    } catch {
      return labelKey;
    }
  }, [labelKey]);

  const load = useCallback(async () => {
    if (!open || !activeDayKey) return;
    setLoading(true);
    setError(null);

    const fetchDay = async (k: string) => {
      return supabase.rpc("painel_cs_slots_dia", {
        p_clinic_id: clinicId,
        p_data: k,
      });
    };

    const parseDayRows = (raw: unknown) => parseSlots(raw);

    try {
      if (isYmdToday(activeDayKey)) {
        let k = activeDayKey;
        for (let i = 0; i < MAX_DAYS_SCAN; i++) {
          await supabase.rpc("painel_cs_ensure_slots_grid", {
            p_clinic_id: clinicId,
            p_data: k,
          });
          const { data, error: e } = await fetchDay(k);
          if (e) {
            setError(
              e.message +
                (e.message.includes("function")
                  ? " — Execute supabase/painel_cs_slots_rpc.sql no Supabase."
                  : "")
            );
            setRows([]);
            return;
          }
          const visible = parseDayRows(data);
          if (visible.length > 0) {
            if (k !== activeDayKey) {
              onAutoAdvanceDay?.(k);
              onDayKeyChange?.(k);
              setActiveDayKey(k);
            }
            setViewDayKey(k);
            setRows(visible);
            return;
          }
          k = addDaysToYmd(k, 1);
        }
        setViewDayKey(activeDayKey);
        setRows([]);
        return;
      }

      await supabase.rpc("painel_cs_ensure_slots_grid", {
        p_clinic_id: clinicId,
        p_data: activeDayKey,
      });
      const { data, error: e } = await fetchDay(activeDayKey);
      if (e) {
        setError(
          e.message +
            (e.message.includes("function")
              ? " — Execute supabase/painel_cs_slots_rpc.sql no Supabase."
              : "")
        );
        setRows([]);
        return;
      }
      setViewDayKey(activeDayKey);
      setRows(parseDayRows(data));
    } finally {
      setLoading(false);
    }
  }, [
    open,
    activeDayKey,
    clinicId,
    supabase,
    onAutoAdvanceDay,
    onDayKeyChange,
  ]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  function shiftModalDay(delta: number) {
    if (!activeDayKey) return;
    const next = addDaysToYmd(activeDayKey, delta);
    setActiveDayKey(next);
    onDayKeyChange?.(next);
  }

  function goModalToday() {
    const t = formatLocalYmd(new Date());
    setActiveDayKey(t);
    onDayKeyChange?.(t);
  }

  const byProf = useMemo(() => {
    const map = new Map<string, CsSlotRow[]>();
    for (const r of rows) {
      const list = map.get(r.profissional_id) ?? [];
      list.push(r);
      map.set(r.profissional_id, list);
    }
    return map;
  }, [rows]);

  /** Só horas que a clínica marcou em «Configurar horários da clínica». */
  const clinicGridHours = useMemo(
    () =>
      [...new Set(clinicVisibleHours.filter((h) => h >= 6 && h <= 22))].sort(
        (a, b) => a - b
      ),
    [clinicVisibleHours]
  );

  const displayGridHours = useMemo(() => {
    const s = new Set<number>();
    for (let h = DISPLAY_HOUR_START; h <= DISPLAY_HOUR_END; h++) s.add(h);
    for (const h of clinicGridHours) {
      if (h >= 6 && h <= 22) s.add(h);
    }
    return [...s].sort((a, b) => a - b);
  }, [clinicGridHours]);

  const profEntriesForDesktop = useMemo(() => {
    const e = Array.from(byProf.entries());
    if (!desktopProfFilter) return e;
    return e.filter(([id]) => id === desktopProfFilter);
  }, [byProf, desktopProfFilter]);

  const profEntriesForMobile = useMemo(() => {
    const e = Array.from(byProf.entries());
    if (!mobileProfId) return e;
    return e.filter(([id]) => id === mobileProfId);
  }, [byProf, mobileProfId]);

  useEffect(() => {
    if (!desktopProfFilter) return;
    if (!byProf.has(desktopProfFilter)) setDesktopProfFilter("");
  }, [byProf, desktopProfFilter]);

  useEffect(() => {
    if (!mobileProfId) return;
    if (!rows.some((r) => r.profissional_id === mobileProfId)) {
      setMobileProfId(null);
    }
  }, [rows, mobileProfId]);

  const isViewToday = Boolean(labelKey && isYmdToday(labelKey));
  const currentHour = new Date().getHours();

  function renderSlotButton(s: CsSlotRow, slotHour: number): ReactNode {
    const livre = s.disponivel;
    const porCliente = !livre && s.indisponivel_por === "cliente";
    const bloqueado = !livre && !porCliente;
    const busy = busyId === s.horario_id;
    const procLabel = s.nome_procedimento?.trim() ?? null;
    const emCurso = isViewToday && porCliente && slotHour === currentHour;

    let estadoLabel: string;
    let chipLabel: string;
    if (livre) {
      estadoLabel = "disponível — horário habilitado na clínica";
      chipLabel = "Livre";
    } else if (bloqueado) {
      estadoLabel = "indisponível — bloqueio manual no painel";
      chipLabel = "Bloq.";
    } else if (emCurso) {
      estadoLabel = "consulta em curso nesta hora";
      chipLabel = "Agora";
    } else {
      estadoLabel = "indisponível — ocupado por agendamento";
      chipLabel = "Agend.";
    }

    const ariaProc = procLabel ? " Procedimento: " + procLabel + "." : "";

    const title = livre
      ? "Marcar como indisponível (bloqueio manual — o agente deixa de listar esta vaga)"
      : porCliente
        ? (procLabel ? procLabel + " — " : "") +
          "Tornar disponível (confirme se quer libertar a vaga com agendamento)"
        : "Marcar como disponível de novo";

    let shell: string;
    if (bloqueado) {
      shell =
        "border border-red-900/70 bg-red-950/75 text-red-300 shadow-sm hover:-translate-y-px focus-visible:outline-red-700";
    } else if (emCurso) {
      shell =
        "border-2 border-orange-400 bg-orange-500 text-white shadow-[0_0_12px_rgba(249,115,22,0.55)] hover:-translate-y-px hover:shadow-[0_0_18px_rgba(249,115,22,0.7)] focus-visible:outline-orange-400";
    } else if (porCliente) {
      shell =
        "border-2 border-teal-400 bg-teal-600 text-white shadow-[0_0_10px_rgba(45,212,191,0.4)] hover:-translate-y-px hover:bg-teal-500 hover:shadow-[0_0_16px_rgba(45,212,191,0.6)] focus-visible:outline-teal-400";
    } else {
      shell =
        "border border-teal-800/80 bg-teal-950/90 text-teal-400 shadow-sm hover:-translate-y-px focus-visible:outline-[var(--primary)]";
    }

    const chipTone = bloqueado
      ? "text-red-400"
      : emCurso
        ? "text-orange-100 font-extrabold"
        : porCliente
          ? "text-teal-100 font-extrabold"
          : "text-teal-600";

    const procTone =
      porCliente || emCurso
        ? "text-white/90"
        : livre
          ? "text-teal-600/80"
          : "text-red-300/90";

    return (
      <button
        key={s.horario_id}
        type="button"
        disabled={busy}
        onClick={() => void toggleSlot(s)}
        aria-pressed={!livre}
        aria-label={s.horario + " — " + estadoLabel + "." + ariaProc + " Clicar para alternar."}
        title={title}
        className={
          "relative flex h-12 w-full min-w-0 flex-col items-center justify-center gap-0 rounded-lg px-0.5 py-0 transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 md:h-14 md:min-w-[72px] " +
          shell
        }
      >
        {/* Indicador de agendamento */}
        {porCliente && !busy ? (
          <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-white/80 shadow-sm" aria-hidden />
        ) : null}
        {emCurso && !busy ? (
          <span className="absolute top-1 right-1 h-2 w-2 animate-pulse rounded-full bg-white shadow-sm" aria-hidden />
        ) : null}
        <span className="text-center text-xs font-bold tabular-nums md:text-sm">
          {busy ? "…" : s.horario}
        </span>
        <span
          className={
            "text-center text-[10px] uppercase tracking-wide not-italic no-underline md:text-xs " +
            chipTone
          }
        >
          {chipLabel}
        </span>
        {procLabel ? (
          <span
            className={
              "line-clamp-1 max-w-full px-0.5 text-center text-[9px] font-medium normal-case leading-tight no-underline md:text-[10px] " +
              procTone
            }
            title={procLabel}
          >
            {procLabel}
          </span>
        ) : null}
      </button>
    );
  }


  async function openClienteModal(slot: CsSlotRow) {
    setConfirmSlot(slot);
    setConfirmAppt(null);
    setConfirmFetching(true);
    setConfirmError(null);
    setConfirmDone(false);
    try {
      const slotHour = parseInt(slot.horario.slice(0, 2), 10);

      // Busca em appointments (painel) e cs_agendamentos (IA) em paralelo
      const [{ data: rows }, { data: csRaw }] = await Promise.all([
        supabase
          .from("appointments")
          .select("id, patients(name, phone), service_name, source, starts_at, ends_at")
          .eq("clinic_id", clinicId)
          .neq("status", "cancelled")
          .gte("starts_at", `${slot.data}T00:00:00`)
          .lt("starts_at", `${slot.data}T23:59:59`)
          .order("starts_at", { ascending: true }),
        supabase.rpc("painel_list_cs_agendamentos", { p_clinic_id: clinicId }),
      ]);

      const matchHour = (startsAt: string) =>
        new Date(startsAt).getHours() === slotHour;

      // Tenta primeiro em appointments (painel)
      const found = (rows ?? []).find((r) => matchHour(r.starts_at));
      if (found) {
        const p = Array.isArray(found.patients) ? found.patients[0] : found.patients;
        setConfirmAppt({
          id: String(found.id),
          patientName: (p as { name?: string | null } | null)?.name ?? null,
          phone: (p as { phone?: string | null } | null)?.phone ?? null,
          serviceName: found.service_name ?? null,
          source: found.source ?? null,
          startsAt: found.starts_at,
          endsAt: found.ends_at,
        });
        return;
      }

      // Tenta em cs_agendamentos (IA/WhatsApp)
      const csRows = Array.isArray(csRaw) ? csRaw : [];
      const csFound = (csRows as Record<string, unknown>[]).find(
        (r) => typeof r.starts_at === "string" && matchHour(r.starts_at)
      );
      if (csFound) {
        const p = Array.isArray(csFound.patients)
          ? (csFound.patients as Record<string, unknown>[])[0]
          : (csFound.patients as Record<string, unknown> | null);
        setConfirmAppt({
          id: String(csFound.id ?? ""),
          patientName: (p?.name as string | null) ?? null,
          phone: (p?.phone as string | null) ?? null,
          serviceName: (csFound.service_name as string | null) ?? null,
          source: (csFound.source as string | null) ?? "whatsapp",
          startsAt: String(csFound.starts_at),
          endsAt: String(csFound.ends_at ?? csFound.starts_at),
        });
      }
    } catch {/* ignore — mostra o modal mesmo sem dados completos */}
    finally { setConfirmFetching(false); }
  }

  async function execToggleSlot(slot: CsSlotRow) {
    const next = !slot.disponivel;
    setBusyId(slot.horario_id);
    setError(null);
    const { data, error: e } = await supabase.rpc(
      "painel_cs_set_slot_disponivel",
      {
        p_clinic_id: clinicId,
        p_horario_id: slot.horario_id,
        p_disponivel: next,
      }
    );
    setBusyId(null);
    if (e) {
      setError(e.message);
      return;
    }
    const ok =
      data &&
      typeof data === "object" &&
      "ok" in data &&
      (data as { ok?: boolean }).ok === true;
    if (!ok) {
      const err = (data as { error?: string }).error;
      setError(
        err === "hour_not_in_clinic_agenda"
          ? "Este horário não está na configuração global da clínica. Abra «Configurar horários da clínica» e habilite o bloco antes de alterar a vaga."
          : "Não foi possível atualizar este horário."
      );
      return;
    }
    setRows((prev) =>
      prev.map((x) =>
        x.horario_id === slot.horario_id
          ? {
              ...x,
              disponivel: next,
              indisponivel_por: next ? null : "medico",
            }
          : x
      )
    );
  }

  async function toggleSlot(slot: CsSlotRow) {
    if (busyId) return;
    const next = !slot.disponivel;
    if (next && slot.indisponivel_por === "cliente") {
      // Abre modal estilizado em vez de window.confirm
      await openClienteModal(slot);
      return;
    }
    await execToggleSlot(slot);
  }

  async function handleConfirmLiberarSlot() {
    if (!confirmSlot) return;
    setConfirmBusy(true);
    setConfirmError(null);
    // Cancela o agendamento (se encontrado) para o agente poder reutilizar o horário
    if (confirmAppt) {
      const id = confirmAppt.id;
      let errMsg: string | null = null;
      if (id.startsWith("cs:")) {
        const { error } = await supabase.rpc("painel_cancel_cs_agendamento", {
          p_clinic_id: clinicId,
          p_cs_agendamento_id: id.slice(3),
        });
        if (error) errMsg = error.message;
      } else {
        const { error } = await supabase
          .from("appointments")
          .update({ status: "cancelled" })
          .eq("id", id);
        if (error) errMsg = error.message;
      }
      if (errMsg) {
        setConfirmError(errMsg);
        setConfirmBusy(false);
        return;
      }
    }
    await execToggleSlot(confirmSlot);
    setConfirmBusy(false);
    setConfirmDone(true);
  }

  async function handleConfirmCancelarAgendamento() {
    if (!confirmSlot || !confirmAppt) return;
    setConfirmBusy(true);
    setConfirmError(null);
    const id = confirmAppt.id;
    let errMsg: string | null = null;
    if (id.startsWith("cs:")) {
      const { error } = await supabase.rpc("painel_cancel_cs_agendamento", {
        p_clinic_id: clinicId,
        p_cs_agendamento_id: id.slice(3),
      });
      if (error) errMsg = error.message;
    } else {
      const { error } = await supabase
        .from("appointments")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) errMsg = error.message;
    }
    if (errMsg) {
      setConfirmError(errMsg);
      setConfirmBusy(false);
      return;
    }
    // Libera o slot também
    await execToggleSlot(confirmSlot);
    setConfirmBusy(false);
    setConfirmDone(true);
  }

  function renderSlotsRow(slots: CsSlotRow[], _compact: boolean) {
    void _compact;
    const dk = labelKey || activeDayKey;
    const gridClass =
      "mt-2 grid w-full grid-cols-4 gap-1.5 sm:grid-cols-6 sm:gap-2 md:grid-cols-[repeat(auto-fill,minmax(72px,1fr))] md:gap-2";
    const byHour = new Map<number, CsSlotRow>();
    for (const s of slots) {
      const h = parseSlotHour(s.horario);
      if (h >= 0) byHour.set(h, s);
    }
    const allowed = new Set(clinicGridHours);
    if (!dk) {
      const fallback = [...slots]
        .filter((s) => allowed.has(parseSlotHour(s.horario)))
        .sort((a, b) => parseSlotHour(a.horario) - parseSlotHour(b.horario));
      return (
        <div className={gridClass}>
          {fallback.map((s) => renderSlotButton(s, parseSlotHour(s.horario)))}
        </div>
      );
    }
    const hint = (
      <p className="col-span-full text-[10px] leading-snug text-[var(--text-muted)]">
        Blocos conforme{" "}
        <strong className="font-medium text-[var(--text)]">Configurar horários da clínica</strong>. Toque
        para bloquear ou libertar vagas (exceto fora da configuração).
      </p>
    );

    const outsideCell = (hour: number) => {
      const label = String(hour).padStart(2, "0") + ":00";
      return (
        <div
          key={"outside-" + hour}
          className="flex h-12 w-full min-w-0 flex-col items-center justify-center gap-0 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-0.5 py-0 text-center opacity-75 md:h-14 md:min-w-[72px]"
          title="Fora dos horários que a clínica configurou para aparecer na agenda"
        >
          <span className="text-center text-xs font-semibold tabular-nums text-[var(--text-muted)] md:text-sm">
            {label}
          </span>
          <span className="text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] md:text-xs">
            —
          </span>
        </div>
      );
    };

    const missingCell = (hour: number) => {
      const label = String(hour).padStart(2, "0") + ":00";
      return (
        <div
          key={"missing-" + hour}
          className="flex h-12 w-full min-w-0 flex-col items-center justify-center gap-0 rounded-lg border border-dashed border-teal-800/50 bg-teal-950/50 px-0.5 py-0 text-center md:h-14 md:min-w-[72px]"
          title="Horário da clínica — sincronização pendente."
        >
          <span className="text-center text-xs font-semibold tabular-nums text-teal-100 md:text-sm">
            {label}
          </span>
          <span className="text-center text-[10px] font-bold uppercase tracking-wide text-teal-300/90 md:text-xs">
            Livre
          </span>
        </div>
      );
    };

    const hoursRow = displayGridHours.map((h) => {
      if (!allowed.has(h)) return outsideCell(h);
      const slot = byHour.get(h);
      if (!slot) return missingCell(h);
      return renderSlotButton(slot, h);
    });

    return (
      <div className={gridClass}>
        {hint}
        {hoursRow}
      </div>
    );
  }

  if (!open) return null;

  const isPanel = presentation === "panel";

  const shell = (
      <div
        className={`relative flex w-full min-w-0 flex-col overflow-y-auto overscroll-contain border border-[var(--border)] bg-[var(--surface)] ${
          isPanel
            ? "max-h-none rounded-2xl shadow-sm"
            : "max-h-[94dvh] max-w-2xl rounded-t-3xl shadow-[0_-8px_40px_-12px_rgba(0,0,0,0.35)] sm:max-h-[min(94dvh,56rem)] sm:rounded-3xl sm:shadow-[0_20px_60px_-20px_rgba(0,0,0,0.45)]"
        }`}
        role={isPanel ? "region" : undefined}
        aria-labelledby="slots-modal-title"
        aria-describedby="slots-modal-desc"
      >
        <div className="sticky top-0 z-[2] border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-sm">
        <header className="flex shrink-0 items-start justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <h2
              id="slots-modal-title"
              className="font-display text-xl font-semibold text-[var(--text)]"
            >
              Horários que aparecem na agenda
            </h2>
            <p id="slots-modal-desc" className="mt-1 text-[var(--text-muted)]">
              <span className="block text-xs sm:hidden">
                Escolha o médico e ajuste as vagas só nos horários que a clínica liberou.
              </span>
              <span className="hidden text-sm sm:block">
                Só aparecem os blocos que a clínica marcou em{" "}
                <strong className="font-medium text-[var(--text)]">Configurar horários da clínica</strong>. Por médico, indique o que o
                agente pode oferecer.
              </span>
            </p>
            {labelKey ? (
              <p className="mt-2 text-sm font-medium capitalize text-[var(--text)]">
                {dateLabel}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg)]"
          >
            Fechar
          </button>
        </header>

        <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg)]/80 px-4 py-2.5 sm:px-6">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Dia a gerir
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!activeDayKey}
              onClick={() => shiftModalDay(-1)}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm font-semibold text-[var(--text)] shadow-sm transition-colors hover:bg-[var(--surface)] disabled:opacity-40"
            >
              Dia anterior
            </button>
            <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial">
              <span className="sr-only">Data</span>
              <input
                type="date"
                disabled={!activeDayKey}
                value={activeDayKey}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setActiveDayKey(v);
                  onDayKeyChange?.(v);
                }}
                className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-sans text-sm text-[var(--text)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-50 sm:min-w-[11rem] sm:flex-initial"
              />
            </label>
            <button
              type="button"
              disabled={!activeDayKey}
              onClick={() => shiftModalDay(1)}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm font-semibold text-[var(--text)] shadow-sm transition-colors hover:bg-[var(--surface)] disabled:opacity-40"
            >
              Próximo dia
            </button>
            <button
              type="button"
              disabled={!activeDayKey || isYmdToday(activeDayKey)}
              onClick={() => goModalToday()}
              className="rounded-xl bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
            >
              Ir para hoje
            </button>
          </div>
        </div>
        </div>

        <div className="px-4 py-3 sm:px-6">
          {!activeDayKey ? (
            <p className="text-sm text-[var(--text-muted)]">Escolha uma data no painel ou aguarde…</p>
          ) : error ? (
            <p className="rounded-xl border border-red-800/50 bg-red-950/40 px-4 py-3 text-sm text-red-100">
              {error}
            </p>
          ) : loading ? (
            <p className="text-sm text-[var(--text-muted)]">A carregar horários…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              {isYmdToday(activeDayKey) ? (
                <>
                  Não há horários úteis neste dia e não foi encontrada agenda nos próximos {MAX_DAYS_SCAN} dias. Verifique profissionais e horários na base, ou escolha <strong className="font-medium text-[var(--text)]">outro dia</strong> acima.
                </>
              ) : (
                <>
                  Sem blocos em <span className="font-medium text-[var(--text)]">{activeDayKey}</span>. Confirme profissionais activos e vínculo com a clínica, ou escolha outra data.
                </>
              )}
            </p>
          ) : (
            <>
              <div className="mb-3">
                <label className="block max-w-xl">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Médico / médica
                  </span>
                  <select
                    value={layoutWide ? desktopProfFilter : (mobileProfId ?? "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (layoutWide) setDesktopProfFilter(v);
                      else setMobileProfId(v === "" ? null : v);
                    }}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] sm:max-w-md"
                  >
                    <option value="">Todos os profissionais</option>
                    {Array.from(byProf.entries()).map(([id, slots]) => {
                      const head = slots[0];
                      return (
                        <option key={id} value={id}>
                          {head?.profissional_nome ?? id}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </div>
              {!layoutWide ? (
                <>
                  <SlotsLegend className="mb-2" />
                  <ul className="flex flex-col gap-4" role="list">
                    {profEntriesForMobile.map(([profId, slots]) => {
                      const head = slots[0];
                      const procsAgend = uniqueProceduresFromSlots(slots);
                      const procsLine = procsAgend.join(" · ");
                      return (
                        <li key={profId} className="list-none">
                          <ProfSectionHeader
                            profId={profId}
                            name={head.profissional_nome}
                            specialty={head.especialidade}
                            photoUrl={professionalAvatarPublicUrl(supabase, profAvatarMap.get(profId)?.path)}
                            emoji={profAvatarMap.get(profId)?.emoji}
                          />
                          {procsLine ? (
                            <p
                              className="mb-1.5 mt-2 line-clamp-2 text-xs font-medium text-teal-200/90"
                              title={procsLine}
                            >
                              {procsLine}
                            </p>
                          ) : null}
                          <div className={procsLine ? "" : "mt-2"}>
                            {renderSlotsRow(slots, true)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <ul className="flex flex-col gap-5" role="list">
                  <li className="list-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Legenda
                    </p>
                    <div className="mt-1.5">
                      <SlotsLegend />
                    </div>
                  </li>
                  {profEntriesForDesktop.map(([profId, slots]) => {
                    const head = slots[0];
                    const procsAgend = uniqueProceduresFromSlots(slots);
                    const procsLine = procsAgend.join(" · ");
                    return (
                      <li key={profId} className="list-none">
                        <ProfSectionHeader
                          profId={profId}
                          name={head.profissional_nome}
                          specialty={head.especialidade}
                          photoUrl={professionalAvatarPublicUrl(supabase, profAvatarMap.get(profId)?.path)}
                          emoji={profAvatarMap.get(profId)?.emoji}
                        />
                        {procsLine ? (
                          <p
                            className="mb-1.5 mt-2 text-xs font-medium text-teal-200/90"
                            title={procsLine}
                          >
                            {procsLine}
                          </p>
                        ) : null}
                        <div className={procsLine ? "" : "mt-2"}>
                          {renderSlotsRow(slots, false)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>


      </div>
  );

  /* ─── Modal de confirmação "cliente agendou" ─────────────────────────────── */
  const clienteModal = confirmSlot ? (() => {
    const slot = confirmSlot;
    const appt = confirmAppt;
    const fmtTime = (iso: string) =>
      new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    const fmtDate = (() => {
      try {
        return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).format(
          new Date(`${slot.data}T${slot.horario.slice(0, 5)}:00`)
        );
      } catch { return slot.data; }
    })();
    const initials = (appt?.patientName ?? "?")
      .split(" ").slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("");
    const isCs = appt?.id?.startsWith("cs:") ?? false;
    const originLabel = isCs ? "Agendamento IA" : appt?.source === "painel" ? "Painel" : (appt?.source ?? "—");

    return (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]"
        role="dialog"
        aria-modal="true"
        onClick={(e) => { if (e.target === e.currentTarget && !confirmBusy) { setConfirmSlot(null); setConfirmingLiberar(false); } }}
      >
        <div className="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] shadow-2xl overflow-hidden">
          {confirmDone ? (
            /* Sucesso */
            <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500"><path d="M20 6 9 17l-5-5"/></svg>
              </span>
              <div>
                <p className="font-display text-lg font-semibold text-[var(--text)]">Operação concluída</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">O horário foi atualizado na agenda.</p>
              </div>
              <button
                type="button"
                onClick={() => { setConfirmSlot(null); setConfirmingLiberar(false); }}
                className="mt-1 rounded-xl bg-[var(--primary)] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[var(--primary-strong)]"
              >
                Fechar
              </button>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Topo: avatar + nome + badges + fechar */}
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]/20 text-base font-bold text-[var(--primary)]">
                  {confirmFetching ? "…" : initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-semibold text-[var(--text)] truncate">
                    {confirmFetching ? "A carregar…" : (appt?.patientName ?? "Paciente")}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--text-muted)]">
                    {slot.profissional_nome}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setConfirmSlot(null); setConfirmingLiberar(false); }}
                    disabled={confirmBusy}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)] disabled:opacity-50"
                    aria-label="Fechar"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              </div>

              {/* Grid de info cards */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                    Data
                  </div>
                  <p className="text-sm font-bold text-[var(--text)]">{fmtDate}</p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                    Horário
                  </div>
                  <p className="text-sm font-bold text-[var(--text)]">{slot.horario.slice(0, 5)}</p>
                  {appt ? <p className="text-[11px] text-[var(--text-muted)]">até {fmtTime(appt.endsAt)}</p> : null}
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    Profissional
                  </div>
                  <p className="text-sm font-bold text-[var(--text)]">{slot.profissional_nome}</p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    Origem
                  </div>
                  <p className={`text-sm font-bold ${isCs ? "text-[var(--primary)]" : "text-[var(--text)]"}`}>
                    {confirmFetching ? "…" : originLabel}
                  </p>
                </div>
              </div>

              {/* Procedimento + Contacto */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                    Procedimentos
                  </div>
                  {slot.nome_procedimento ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--primary)]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--primary)]">
                      {slot.nome_procedimento}
                    </span>
                  ) : (
                    <p className="text-xs text-[var(--text-muted)]">{confirmFetching ? "…" : (appt?.serviceName ?? "—")}</p>
                  )}
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.61 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l.96-.86a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 17.92z"/></svg>
                    Contacto
                  </div>
                  {confirmFetching ? (
                    <p className="text-sm font-bold text-[var(--text)]">…</p>
                  ) : appt?.phone ? (
                    <a
                      href={`https://wa.me/${appt.phone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-bold text-[var(--primary)] hover:underline"
                    >
                      {appt.phone.replace(/@.*$/, "").replace(/\D/g, "")}
                    </a>
                  ) : (
                    <p className="text-sm font-bold text-[var(--text)]">—</p>
                  )}
                </div>
              </div>

              {/* Aviso */}
              <div className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] px-4 py-3 text-xs leading-relaxed text-[var(--warning-text)]">
                <p className="font-semibold mb-1">O que acontece ao desmarcar?</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>O agendamento é marcado como <strong>cancelado</strong> no sistema.</li>
                  <li>O horário fica <strong>disponível</strong> novamente na agenda.</li>
                  {isCs ? <li>Como veio pelo WhatsApp/IA, o registo no agente também é cancelado.</li> : null}
                  <li>O paciente <strong>não é notificado automaticamente</strong> — contacte-o se necessário.</li>
                </ul>
              </div>

              {confirmError ? (
                <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2.5 text-xs text-[var(--danger-text)]">
                  {confirmError}
                </p>
              ) : null}

              {/* Acções */}
              {confirmingLiberar ? (
                /* Confirmação "Só liberar horário" */
                <div className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] p-4 space-y-3">
                  <p className="text-sm font-semibold text-[var(--warning-text)]">Tem a certeza?</p>
                  <p className="text-xs text-[var(--warning-text)] leading-relaxed">
                    O agendamento será <strong>cancelado</strong> e o horário ficará <strong>disponível</strong> para o agente fazer novos agendamentos. O paciente não será notificado automaticamente.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingLiberar(false)}
                      disabled={confirmBusy}
                      className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-soft)] disabled:opacity-50 transition-colors"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleConfirmLiberarSlot()}
                      disabled={confirmBusy}
                      className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                    >
                      {confirmBusy ? "A processar…" : "Sim, liberar para novos agendamentos"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => { setConfirmSlot(null); setConfirmingLiberar(false); }}
                    disabled={confirmBusy}
                    className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-soft)] disabled:opacity-50 transition-colors"
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingLiberar(true)}
                    disabled={confirmBusy || confirmFetching}
                    className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-soft)] disabled:opacity-50 transition-colors"
                  >
                    Só liberar horário
                  </button>
                  {appt ? (
                    <button
                      type="button"
                      onClick={() => void handleConfirmCancelarAgendamento()}
                      disabled={confirmBusy || confirmFetching}
                      className="flex items-center justify-center gap-2 rounded-xl bg-red-600/90 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      {confirmBusy ? "A cancelar…" : "Cancelar agendamento"}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  })() : null;

  if (isPanel) {
    return (
      <>
        {clienteModal}
        <div className="w-full min-w-0 max-w-none text-left" role="region" aria-label="Horários por médico">
          {shell}
        </div>
      </>
    );
  }

  return (
    <>
      {clienteModal}
      <div
        className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slots-modal-title"
        aria-describedby="slots-modal-desc"
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity"
          aria-label="Fechar"
          onClick={onClose}
        />
        {shell}
      </div>
    </>
  );
}
