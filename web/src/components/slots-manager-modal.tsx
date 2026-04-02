"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDaysToYmd,
  formatLocalYmd,
  isYmdToday,
  parseLocalYmd,
} from "@/lib/local-day";
import { professionalInitials } from "@/lib/professional-avatar";
import { resolveProfessionalCardStyle } from "@/lib/professional-palette";
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
}: {
  profId: string;
  name: string;
  specialty: string | null;
}) {
  const accent = resolveProfessionalCardStyle(null, profId).accent;
  const initials = professionalInitials(name);
  return (
    <div className="flex items-start gap-3">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tracking-tight text-white shadow-md ring-2 ring-white/10"
        style={{ backgroundColor: accent }}
        aria-hidden
      >
        {initials}
      </div>
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

  useEffect(() => {
    const id = window.setInterval(() => setClockTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

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

  function renderSlotButton(
    s: CsSlotRow,
    compact: boolean,
    slotHour: number
  ): ReactNode {
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

    const pad = compact ? "px-1.5 py-1 min-w-[3.25rem]" : "px-2 py-1 min-w-[3.75rem]";
    const textMain = compact ? "text-[10px] leading-tight" : "text-[11px] leading-tight";
    const textChip = compact ? "text-[7px]" : "text-[8px]";
    const procSize = compact ? "text-[7px]" : "text-[8px]";
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
        "border border-red-900/70 bg-red-950/75 text-red-100 shadow-sm hover:-translate-y-px focus-visible:outline-red-700 line-through decoration-red-300/60 hover:no-underline";
    } else if (emCurso) {
      shell =
        "border border-orange-500/80 bg-orange-500/25 text-orange-100 shadow-sm hover:-translate-y-px focus-visible:outline-orange-500";
    } else if (porCliente) {
      shell =
        "border border-teal-400/70 bg-teal-500/20 text-teal-50 shadow-sm hover:-translate-y-px focus-visible:outline-teal-400 line-through decoration-teal-600/45 hover:no-underline";
    } else {
      shell =
        "border border-teal-800/80 bg-teal-950/90 text-teal-100 shadow-sm hover:-translate-y-px focus-visible:outline-[var(--primary)]";
    }

    const chipTone = bloqueado
      ? "text-red-200/95"
      : emCurso
        ? "text-orange-200"
        : porCliente
          ? "text-teal-200"
          : "text-teal-200/90";

    const procTone =
      porCliente || emCurso
        ? "text-teal-100/95"
        : livre
          ? "text-teal-100/80"
          : "text-red-100/90";

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
          "flex " +
          pad +
          " flex-col items-stretch gap-0 rounded-lg font-semibold tabular-nums transition-[transform,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 " +
          textMain +
          " " +
          shell
        }
      >
        <span>{busy ? "…" : s.horario}</span>
        <span
          className={textChip + " font-bold uppercase tracking-wide not-italic no-underline " + chipTone}
        >
          {chipLabel}
        </span>
        {procLabel ? (
          <span
            className={procSize + " line-clamp-1 text-left font-medium normal-case leading-tight no-underline " + procTone}
            title={procLabel}
          >
            {procLabel}
          </span>
        ) : null}
      </button>
    );
  }

  async function toggleSlot(slot: CsSlotRow) {
    if (busyId) return;
    const next = !slot.disponivel;
    if (next && slot.indisponivel_por === "cliente") {
      const ok = window.confirm(
        "Este horário está indisponível porque um cliente agendou.\n\n" +
          "Tem certeza de que quer tirar esta reserva da agenda (tornar a vaga disponível)? " +
          "Isto não apaga o agendamento na base — se a consulta não vai realizar-se, cancele o agendamento no painel antes."
      );
      if (!ok) return;
    }
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


  function renderSlotsRow(slots: CsSlotRow[], compact: boolean) {
    const dk = labelKey || activeDayKey;
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
        <div className={"flex flex-wrap gap-1.5 " + (compact ? "" : "")}>
          {fallback.map((s) => renderSlotButton(s, compact, parseSlotHour(s.horario)))}
        </div>
      );
    }
    const hint = (
      <p
        className={
          "text-[10px] leading-snug text-[var(--text-muted)] " +
          (compact ? "col-span-4 mb-1 sm:col-span-6" : "mb-1.5")
        }
      >
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
          className={
            "flex flex-col items-center justify-center gap-0 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-1 py-0.5 text-center opacity-75 " +
            (compact ? "min-w-[3.25rem]" : "min-w-[3.75rem]")
          }
          title="Fora dos horários que a clínica configurou para aparecer na agenda"
        >
          <span
            className={
              compact
                ? "text-[10px] font-semibold tabular-nums text-[var(--text-muted)]"
                : "text-[11px] font-semibold tabular-nums text-[var(--text-muted)]"
            }
          >
            {label}
          </span>
          <span className="text-[6px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">—</span>
        </div>
      );
    };

    const missingCell = (hour: number) => {
      const label = String(hour).padStart(2, "0") + ":00";
      return (
        <div
          key={"missing-" + hour}
          className={
            "flex flex-col items-stretch gap-0 rounded-lg border border-dashed border-teal-800/50 bg-teal-950/50 px-1 py-1 text-center " +
            (compact ? "min-w-[3.25rem]" : "min-w-[3.75rem]")
          }
          title="Horário da clínica — sincronização pendente."
        >
          <span
            className={
              compact
                ? "text-[10px] font-semibold tabular-nums text-teal-100"
                : "text-[11px] font-semibold tabular-nums text-teal-100"
            }
          >
            {label}
          </span>
          <span className="text-[7px] font-bold uppercase tracking-wide text-teal-300/90">Livre</span>
        </div>
      );
    };

    const hoursRow = displayGridHours.map((h) => {
      if (!allowed.has(h)) return outsideCell(h);
      const slot = byHour.get(h);
      if (!slot) return missingCell(h);
      return renderSlotButton(slot, compact, h);
    });

    if (compact) {
      return (
        <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
          {hint}
          {hoursRow}
        </div>
      );
    }
    return (
      <div>
        {hint}
        <div className="flex flex-wrap gap-1.5">{hoursRow}</div>
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

  if (isPanel) {
    return (
      <div className="w-full min-w-0 max-w-none text-left" role="region" aria-label="Horários por médico">
        {shell}
      </div>
    );
  }

  return (
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
  );
}
