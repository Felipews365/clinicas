"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDaysToYmd,
  formatLocalYmd,
  isYmdToday,
  parseLocalYmd,
} from "@/lib/local-day";
import { parseSlotHour } from "@/lib/slots-expediente";

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

  /** Só horários em `clinicVisibleHours`; livre ⇒ sempre DISPONÍVEL (nunca «extra listado»). */
  function renderSlotButton(s: CsSlotRow, compact: boolean): ReactNode {
    const livre = s.disponivel;
    const porCliente = !livre && s.indisponivel_por === "cliente";
    const busy = busyId === s.horario_id;
    const procLabel = s.nome_procedimento?.trim() ?? null;

    let estadoLabel: string;
    let chipLabel: string;
    if (livre) {
      estadoLabel = "disponível para o agente — horário habilitado em Configurar horários da clínica";
      chipLabel = "DISPONÍVEL";
    } else if (porCliente) {
      estadoLabel = "indisponível — ocupado por agendamento";
      chipLabel = "COM CLIENTE";
    } else {
      estadoLabel = "indisponível — bloqueio manual no painel";
      chipLabel = "BLOQUEADO";
    }

    const pad = compact ? "px-2 py-1.5 min-w-[4.25rem]" : "px-3 py-2 min-w-[5.5rem]";
    const textMain = compact ? "text-xs" : "text-sm";
    const textChip = compact ? "text-[8px]" : "text-[10px]";
    const procSize = compact ? "text-[9px]" : "text-[10px]";
    const ariaProc = procLabel ? ` Procedimento: ${procLabel}.` : "";

    const title = livre
      ? "Marcar como indisponível (bloqueio manual — o agente deixa de listar esta vaga)"
      : porCliente
        ? (procLabel ? `${procLabel} — ` : "") +
          "Tornar disponível (confirme se quer libertar a vaga com agendamento)"
        : "Marcar como disponível de novo";

    const chipTone = livre
      ? "text-[#3d6b62]/90"
      : porCliente
        ? "text-[#4a5f8a]"
        : "text-[#b91c1c]";

    const procTone = porCliente
      ? "text-[#2c3d6b]/95"
      : livre
        ? "text-[#3d6b62]/85"
        : "text-[#7f1d1d]/90";

    const shell = livre
      ? "border border-[#c5ddd4] bg-[#f0faf6] text-[#1e4d40] shadow-sm hover:-translate-y-px focus-visible:outline-[#3d6b62]"
      : porCliente
        ? "border border-[#b8c5e0] bg-[#eef2fb] text-[#2c3d6b] line-through decoration-[#7d8ab0] hover:no-underline focus-visible:outline-[#4a5f8a]"
        : "border border-[#e8b4b4] bg-[#fef2f2] text-[#7f1d1d] line-through decoration-[#b91c1c]/55 hover:no-underline focus-visible:outline-[#b91c1c]";

    return (
      <button
        key={s.horario_id}
        type="button"
        disabled={busy}
        onClick={() => void toggleSlot(s)}
        aria-pressed={!livre}
        aria-label={`${s.horario} — ${estadoLabel}.${ariaProc} Clicar para alternar.`}
        title={title}
        className={`flex ${pad} flex-col items-stretch gap-0.5 rounded-xl font-semibold tabular-nums transition-[transform,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${textMain} ${shell}`}
      >
        <span>{busy ? "…" : s.horario}</span>
        <span
          className={`${textChip} font-medium uppercase tracking-wide not-italic no-underline ${chipTone}`}
        >
          {chipLabel}
        </span>
        {procLabel ? (
          <span
            className={`${procSize} mt-0.5 line-clamp-2 text-left font-medium normal-case leading-tight no-underline ${procTone}`}
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

  /** Só horas habilitadas em «Configurar horários da clínica»; depois segue expediente + vagas. */
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
        <div className={`flex flex-wrap gap-2 ${compact ? "" : ""}`}>
          {fallback.map((s) => renderSlotButton(s, compact))}
        </div>
      );
    }
    const hint = (
      <p
        className={`text-[11px] leading-snug text-[#6b635a] ${compact ? "col-span-3 mb-2 sm:col-span-4" : "mb-2"}`}
      >
        <strong className="font-medium text-[#3d3d3a]">Grade oficial.</strong> Só entram blocos marcados em{" "}
        <strong className="font-medium">Configurar horários da clínica</strong>. Por defeito cada bloco é{" "}
        <strong className="font-medium">DISPONÍVEL</strong> para o agente; com reserva real mostramos{" "}
        <strong className="font-medium">COM CLIENTE</strong> e com bloqueio manual{" "}
        <strong className="font-medium">BLOQUEADO</strong>.
      </p>
    );
    const missingCell = (hour: number) => {
      const label = `${String(hour).padStart(2, "0")}:00`;
      return (
        <div
          key={`missing-${hour}`}
          className={`flex flex-col items-stretch gap-0.5 rounded-xl border border-dashed border-[#c5ddd4] bg-[#f4fbf8] px-2 py-2 text-center ${compact ? "min-w-[4.25rem] px-2 py-1.5" : "min-w-[5.5rem] px-3 py-2"}`}
          title="Bloco da clínica sem linha sincronizada — estado esperado: disponível após grelha."
        >
          <span
            className={
              compact ? "text-xs font-semibold tabular-nums text-[#1e4d40]" : "text-sm font-semibold tabular-nums text-[#1e4d40]"
            }
          >
            {label}
          </span>
          <span className="text-[8px] font-semibold uppercase tracking-wide text-[#3d6b62]/85">DISPONÍVEL</span>
        </div>
      );
    };
    const visibleGridHours = clinicGridHours;
    const cells = visibleGridHours.map((h) => {
      const s = byHour.get(h);
      if (!s) return missingCell(h);
      return renderSlotButton(s, compact);
    });
    if (compact) {
      return (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {hint}
          {cells}
        </div>
      );
    }
    return (
      <div>
        {hint}
        <div className="flex flex-wrap gap-2">{cells}</div>
      </div>
    );
  }

  if (!open) return null;

  const isPanel = presentation === "panel";

  const shell = (
      <div
        className={`relative flex w-full min-w-0 flex-col overflow-y-auto overscroll-contain border bg-[#fffdf9] ${
          isPanel
            ? "max-h-none rounded-[18px] border-[#dfe8e5] shadow-sm"
            : "max-h-[94dvh] max-w-2xl rounded-t-3xl border-[#e8e2d9] shadow-[0_-8px_40px_-12px_rgba(44,40,37,0.2)] sm:max-h-[min(94dvh,56rem)] sm:rounded-3xl sm:shadow-[0_20px_60px_-20px_rgba(44,40,37,0.28)]"
        }`}
        role={isPanel ? "region" : undefined}
        aria-labelledby="slots-modal-title"
        aria-describedby="slots-modal-desc"
      >
        <div className="sticky top-0 z-[2] bg-[#fffdf9] shadow-[0_4px_12px_-8px_rgba(44,40,37,0.15)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#ebe6dd] px-6 py-5">
          <div>
            <h2
              id="slots-modal-title"
              className="font-display text-xl font-semibold text-[#1f1c1a]"
            >
              Horários que aparecem na agenda
            </h2>
            <p id="slots-modal-desc" className="mt-1 text-[#6b635a]">
              <span className="block text-xs sm:hidden">
                Escolha o médico e ajuste as vagas só nos horários que a clínica liberou.
              </span>
              <span className="hidden text-sm sm:block">
                Só aparecem os blocos que a clínica marcou em{" "}
                <strong className="font-medium">Configurar horários da clínica</strong>. Por médico, indique o que o
                agente pode oferecer.
              </span>
            </p>
            {labelKey ? (
              <p className="mt-2 text-sm font-medium capitalize text-[#2c2825]">
                {dateLabel}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#dcd5ca] bg-white px-3 py-2 text-sm font-medium text-[#5c5348] hover:bg-[#f7f4ef]"
          >
            Fechar
          </button>
        </header>

        <div className="shrink-0 border-b border-[#ebe6dd] bg-[#faf8f5]/90 px-4 py-3 sm:px-6">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#8a8278]">
            Dia a gerir
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!activeDayKey}
              onClick={() => shiftModalDay(-1)}
              className="rounded-xl border border-[#b8c8dc] bg-[#eef3fb] px-3 py-2 text-sm font-semibold text-[#2a4a6e] shadow-sm transition-colors hover:bg-[#e2ebf8] disabled:opacity-40"
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
                className="min-w-0 flex-1 rounded-xl border border-[#dcd5ca] bg-white px-3 py-2 font-sans text-sm text-[#2c2825] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3d6b62] disabled:opacity-50 sm:min-w-[11rem] sm:flex-initial"
              />
            </label>
            <button
              type="button"
              disabled={!activeDayKey}
              onClick={() => shiftModalDay(1)}
              className="rounded-xl border border-[#e4c9a8] bg-[#fff6eb] px-3 py-2 text-sm font-semibold text-[#8b4e12] shadow-sm transition-colors hover:bg-[#ffefd9] disabled:opacity-40"
            >
              Próximo dia
            </button>
            <button
              type="button"
              disabled={!activeDayKey || isYmdToday(activeDayKey)}
              onClick={() => goModalToday()}
              className="rounded-xl bg-[#4D6D66] px-3 py-2 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-[#3f5e58] active:bg-[#283f3a] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
            >
              Ir para hoje
            </button>
          </div>
        </div>
        </div>

        <div className="px-6 py-4">
          {!activeDayKey ? (
            <p className="text-sm text-[#7a7268]">Escolha uma data no painel ou aguarde…</p>
          ) : error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              {error}
            </p>
          ) : loading ? (
            <p className="text-sm text-[#7a7268]">A carregar horários…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm leading-relaxed text-[#6b635a]">
              {isYmdToday(activeDayKey) ? (
                <>
                  Não há horários futuros neste dia (ou os blocos já passaram) e não foi encontrada
                  agenda nos próximos {MAX_DAYS_SCAN} dias em{" "}
                  <code className="rounded bg-[#f0ebe3] px-1 text-xs">cs_horarios_disponiveis</code>.
                  Confirme o seed/SQL, o <code className="rounded bg-[#f0ebe3] px-1 text-xs">clinic_id</code>{" "}
                  dos profissionais, ou escolha <strong className="font-medium">outro dia</strong> acima.
                </>
              ) : (
                <>
                  Sem blocos de horário em{" "}
                  <span className="font-medium">{activeDayKey}</span> na base{" "}
                  <code className="rounded bg-[#f0ebe3] px-1 text-xs">cs_horarios_disponiveis</code>.
                  Gere vagas pelo seed/SQL ou confirme se os profissionais têm{" "}
                  <code className="rounded bg-[#f0ebe3] px-1 text-xs">clinic_id</code> igual à sua
                  clínica.
                </>
              )}
            </p>
          ) : (
            <>
              <div className="mb-4">
                <label className="block max-w-xl">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#8a8278]">
                    Médico / médica
                  </span>
                  <select
                    value={layoutWide ? desktopProfFilter : (mobileProfId ?? "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (layoutWide) setDesktopProfFilter(v);
                      else setMobileProfId(v === "" ? null : v);
                    }}
                    className="w-full rounded-xl border border-[#dcd5ca] bg-white px-3 py-2.5 text-sm font-medium text-[#2c2825] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3d6b62] sm:max-w-md"
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
                  <p className="mb-3 text-[10px] leading-snug text-[#5c5348]">
                    <span className="mr-2 inline-block">
                      <span
                        className="mr-1 inline-block h-2.5 w-4 rounded border border-[#c5ddd4] bg-[#f0faf6] align-middle"
                        aria-hidden
                      />
                      DISPONÍVEL
                    </span>
                    <span className="mr-2 inline-block">
                      <span
                        className="mr-1 inline-block h-2.5 w-4 rounded border border-[#b8c5e0] bg-[#eef2fb] align-middle"
                        aria-hidden
                      />
                      COM CLIENTE
                    </span>
                    <span className="inline-block">
                      <span
                        className="mr-1 inline-block h-2.5 w-4 rounded border border-[#e8b4b4] bg-[#fef2f2] align-middle"
                        aria-hidden
                      />
                      BLOQUEADO
                    </span>
                  </p>
                  <ul className="flex flex-col gap-5" role="list">
                    {profEntriesForMobile.map(([profId, slots]) => {
                      const head = slots[0];
                      const procsAgend = uniqueProceduresFromSlots(slots);
                      const procsLine = procsAgend.join(" · ");
                      return (
                        <li key={profId} className="list-none">
                          <h3 className="text-base font-semibold text-[#1f1c1a]">
                            {head.profissional_nome}
                          </h3>
                          <p className="mt-0.5 text-xs text-[#8a8278]">
                            {head.especialidade?.trim() || "Profissional"}
                          </p>
                          {procsLine ? (
                            <p
                              className="mb-2 mt-1 line-clamp-2 text-sm font-medium text-[#2c3d6b]"
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
                <ul className="flex flex-col gap-6" role="list">
                  <li className="list-none rounded-xl border border-[#ebe6dd] bg-[#faf8f5] px-3 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8278]">
                      Legenda
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#5c5348]">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-4 w-6 shrink-0 rounded-md border border-[#c5ddd4] bg-[#f0faf6]"
                          aria-hidden
                        />
                        DISPONÍVEL — grade da clínica, vaga aberta ao agente
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-4 w-6 shrink-0 rounded-md border border-[#b8c5e0] bg-[#eef2fb]"
                          aria-hidden
                        />
                        COM CLIENTE — reserva ativa
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-4 w-6 shrink-0 rounded-md border border-[#e8b4b4] bg-[#fef2f2]"
                          aria-hidden
                        />
                        BLOQUEADO — bloqueio manual no painel
                      </span>
                    </div>
                  </li>
                  {profEntriesForDesktop.map(([profId, slots]) => {
                    const head = slots[0];
                    const procsAgend = uniqueProceduresFromSlots(slots);
                    const procsLine = procsAgend.join(" · ");
                    return (
                      <li key={profId} className="list-none">
                        <h3 className="text-base font-semibold text-[#1f1c1a]">
                          {head.profissional_nome}
                        </h3>
                        <p className="mt-0.5 text-xs text-[#8a8278]">
                          {head.especialidade?.trim() || "Profissional"}
                        </p>
                        {procsLine ? (
                          <p
                            className="mb-2 mt-1 text-sm font-medium text-[#2c3d6b]"
                            title={procsLine}
                          >
                            {procsLine}
                          </p>
                        ) : null}
                        <div className={procsLine ? "" : "mt-3"}>
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

        <footer className="shrink-0 border-t border-[#ebe6dd] px-6 py-4">
          <p className="hidden text-xs leading-relaxed text-[#8a8278] sm:block">
            Blocos da grelha ={" "}
            <code className="rounded bg-[#f0ebe3] px-1">clinics.agenda_visible_hours</code>; criados em{" "}
            <code className="rounded bg-[#f0ebe3] px-1">painel_cs_ensure_slots_grid</code>. Só{" "}
            <code className="rounded bg-[#f0ebe3] px-1">disponivel = true</code> entra em{" "}
            <code className="rounded bg-[#f0ebe3] px-1">n8n_cs_consultar_vagas</code>.
          </p>
        </footer>
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
        className="absolute inset-0 bg-[#1c1917]/40 backdrop-blur-[2px] transition-opacity"
        aria-label="Fechar"
        onClick={onClose}
      />
      {shell}
    </div>
  );
}
