"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDaysToYmd,
  filterSlotRowsNotPastToday,
  formatLocalYmd,
  isYmdToday,
  parseLocalYmd,
} from "@/lib/local-day";

export type CsSlotRow = {
  horario_id: string;
  profissional_id: string;
  profissional_nome: string;
  especialidade: string | null;
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
};

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
    const disponivel = Boolean(o.disponivel);
    let indisponivel_por: CsSlotRow["indisponivel_por"] = null;
    if (!disponivel) {
      const por = o.indisponivel_por;
      indisponivel_por = por === "cliente" ? "cliente" : "medico";
    }
    return {
      horario_id: String(o.horario_id ?? ""),
      profissional_id: String(o.profissional_id ?? ""),
      profissional_nome: String(o.profissional_nome ?? ""),
      especialidade:
        o.especialidade == null || o.especialidade === ""
          ? null
          : String(o.especialidade),
      data: String(o.data ?? ""),
      horario: String(o.horario ?? ""),
      disponivel,
      indisponivel_por,
    } satisfies CsSlotRow;
  });
}

const MAX_DAYS_SCAN = 21;

export function SlotsManagerModal({
  open,
  onClose,
  supabase,
  clinicId,
  dayKey,
  onAutoAdvanceDay,
  onDayKeyChange,
}: Props) {
  const [rows, setRows] = useState<CsSlotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Dia selecionado neste modal (pode diferir do painel até sincronizar). */
  const [activeDayKey, setActiveDayKey] = useState("");
  /** Dia efetivamente carregado (scan “hoje” pode saltar para o próximo dia útil). */
  const [viewDayKey, setViewDayKey] = useState<string | null>(null);
  /** Mobile (< sm): null = só lista de profissionais; id = horários desse profissional. */
  const [mobileProfId, setMobileProfId] = useState<string | null>(null);
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

    const applyTimeFilter = (raw: unknown, k: string) =>
      filterSlotRowsNotPastToday(parseSlots(raw), k);

    try {
      if (isYmdToday(activeDayKey)) {
        let k = activeDayKey;
        for (let i = 0; i < MAX_DAYS_SCAN; i++) {
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
          const visible = applyTimeFilter(data, k);
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
      setRows(applyTimeFilter(data, activeDayKey));
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

  useEffect(() => {
    if (!mobileProfId) return;
    if (!rows.some((r) => r.profissional_id === mobileProfId)) {
      setMobileProfId(null);
    }
  }, [rows, mobileProfId]);

  function renderSlotButton(s: CsSlotRow, compact: boolean): ReactNode {
    const livre = s.disponivel;
    const porCliente = !livre && s.indisponivel_por === "cliente";
    const busy = busyId === s.horario_id;
    const estadoLabel = livre
      ? "disponível para o agente"
      : porCliente
        ? "indisponível — ocupado por agendamento"
        : "indisponível — bloqueio manual";
    const chipLabel = livre
      ? "Disponível"
      : porCliente
        ? "Com cliente"
        : "Bloqueado";
    const pad = compact ? "px-2 py-1.5 min-w-[4.25rem]" : "px-3 py-2 min-w-[5.5rem]";
    const textMain = compact ? "text-xs" : "text-sm";
    const textChip = compact ? "text-[8px]" : "text-[10px]";
    return (
      <button
        key={s.horario_id}
        type="button"
        disabled={busy}
        onClick={() => void toggleSlot(s)}
        aria-pressed={!livre}
        aria-label={`${s.horario} — ${estadoLabel}. Clicar para alternar.`}
        title={
          livre
            ? "Marcar como indisponível (o agente deixa de listar)"
            : porCliente
              ? "Tornar disponível (confirma se quer libertar a vaga com agendamento)"
              : "Marcar como disponível de novo"
        }
        className={`flex ${pad} flex-col items-stretch gap-0.5 rounded-xl font-semibold tabular-nums transition-[transform,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${textMain} ${
          livre
            ? "border border-[#c5ddd4] bg-[#f0faf6] text-[#1e4d40] shadow-sm hover:-translate-y-px focus-visible:outline-[#3d6b62]"
            : porCliente
              ? "border border-[#b8c5e0] bg-[#eef2fb] text-[#2c3d6b] line-through decoration-[#7d8ab0] hover:no-underline focus-visible:outline-[#4a5f8a]"
              : "border border-[#e8b4b4] bg-[#fef2f2] text-[#7f1d1d] line-through decoration-[#b91c1c]/55 hover:no-underline focus-visible:outline-[#b91c1c]"
        }`}
      >
        <span>{busy ? "…" : s.horario}</span>
        <span
          className={`${textChip} font-medium uppercase tracking-wide not-italic no-underline ${
            livre
              ? "text-[#3d6b62]/90"
              : porCliente
                ? "text-[#4a5f8a]"
                : "text-[#b91c1c]"
          }`}
        >
          {chipLabel}
        </span>
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
      setError("Não foi possível atualizar este horário.");
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

  if (!open) return null;

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
      <div className="relative flex max-h-[min(92vh,720px)] w-full max-w-2xl flex-col rounded-t-3xl border border-[#e8e2d9] bg-[#fffdf9] shadow-[0_-8px_40px_-12px_rgba(44,40,37,0.2)] sm:rounded-3xl sm:shadow-[0_20px_60px_-20px_rgba(44,40,37,0.28)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#ebe6dd] px-6 py-5">
          <div>
            <h2
              id="slots-modal-title"
              className="font-display text-xl font-semibold text-[#1f1c1a]"
            >
              Horários da agenda (WhatsApp)
            </h2>
            <p id="slots-modal-desc" className="mt-1 text-[#6b635a]">
              <span className="block text-xs sm:hidden">
                Toque num profissional para ver os horários deste dia.
              </span>
              <span className="hidden text-sm sm:block">
                Cada bloco alterna entre <strong className="font-medium">disponível</strong> (o
                agente oferece em <code className="rounded bg-[#f0ebe3] px-1 text-xs">consultar vagas</code>)
                e <strong className="font-medium">indisponível</strong> (não entra na lista). No{" "}
                <strong className="font-medium">dia de hoje</strong> só aparecem horários ainda por
                vir. Use <strong className="font-medium">mudar o dia</strong> abaixo para gerir outras
                datas.
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

        <div
          className={`min-h-0 flex-1 px-6 py-4 ${
            !layoutWide && mobileProfId
              ? "flex min-h-[12rem] flex-col overflow-hidden"
              : "overflow-y-auto"
          }`}
        >
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
          ) : !layoutWide && !mobileProfId ? (
            <ul className="flex flex-col gap-2" role="list">
              {Array.from(byProf.entries()).map(([profId, slots]) => {
                const head = slots[0];
                return (
                  <li key={profId} className="list-none">
                    <button
                      type="button"
                      onClick={() => setMobileProfId(profId)}
                      className="flex w-full flex-col items-stretch gap-0.5 rounded-xl border border-[#ebe6dd] bg-[#faf8f5] px-4 py-3 text-left shadow-sm transition-[background-color,transform] hover:bg-[#f5f2ec] active:scale-[0.99]"
                    >
                      <span className="text-base font-semibold text-[#1f1c1a]">
                        {head.profissional_nome}
                      </span>
                      <span className="text-xs text-[#8a8278]">
                        {head.especialidade?.trim() || "Profissional"}
                      </span>
                      <span className="text-[11px] font-medium tabular-nums text-[#6b635a]">
                        {slots.length} horário{slots.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : !layoutWide && mobileProfId ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <button
                type="button"
                onClick={() => setMobileProfId(null)}
                className="mb-3 shrink-0 self-start rounded-xl border border-[#dcd5ca] bg-white px-3 py-2 text-sm font-medium text-[#5c5348] hover:bg-[#f7f4ef]"
              >
                ← Profissionais
              </button>
              {(() => {
                const slots = byProf.get(mobileProfId) ?? [];
                const head = slots[0];
                return (
                  <>
                    {head ? (
                      <div className="shrink-0">
                        <h3 className="text-base font-semibold text-[#1f1c1a]">
                          {head.profissional_nome}
                        </h3>
                        <p className="mt-0.5 text-xs text-[#8a8278]">
                          {head.especialidade?.trim() || "Profissional"}
                        </p>
                      </div>
                    ) : null}
                    <p className="mt-2 text-[10px] leading-snug text-[#5c5348] sm:hidden">
                      <span className="mr-2 inline-block">
                        <span
                          className="mr-1 inline-block h-2.5 w-4 rounded border border-[#b8c5e0] bg-[#eef2fb] align-middle"
                          aria-hidden
                        />
                        Cliente
                      </span>
                      <span className="inline-block">
                        <span
                          className="mr-1 inline-block h-2.5 w-4 rounded border border-[#e8b4b4] bg-[#fef2f2] align-middle"
                          aria-hidden
                        />
                        Bloqueio
                      </span>
                    </p>
                    <div
                      className="mt-3 grid min-h-0 min-w-0 flex-1 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4"
                      style={{ maxHeight: "min(52dvh, 360px)" }}
                    >
                      {slots.map((s) => renderSlotButton(s, true))}
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            <ul className="flex flex-col gap-6" role="list">
              <li className="list-none rounded-xl border border-[#ebe6dd] bg-[#faf8f5] px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8a8278]">
                  Legenda
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#5c5348]">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-4 w-6 shrink-0 rounded-md border border-[#b8c5e0] bg-[#eef2fb]"
                      aria-hidden
                    />
                    Indisponível — cliente agendou
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-4 w-6 shrink-0 rounded-md border border-[#e8b4b4] bg-[#fef2f2]"
                      aria-hidden
                    />
                    Indisponível — bloqueio manual
                  </span>
                </div>
              </li>
              {Array.from(byProf.entries()).map(([profId, slots]) => {
                const head = slots[0];
                return (
                  <li key={profId} className="list-none">
                    <h3 className="text-base font-semibold text-[#1f1c1a]">
                      {head.profissional_nome}
                    </h3>
                    <p className="mb-3 mt-0.5 text-xs text-[#8a8278]">
                      {head.especialidade?.trim() || "Profissional"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {slots.map((s) => renderSlotButton(s, false))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="shrink-0 border-t border-[#ebe6dd] px-6 py-4">
          <p className="hidden text-xs leading-relaxed text-[#8a8278] sm:block">
            A cor <strong className="font-medium text-[#6b635a]">azul</strong> indica vaga com
            agendamento ativo em{" "}
            <code className="rounded bg-[#f0ebe3] px-1">cs_agendamentos</code>; a cor{" "}
            <strong className="font-medium text-[#6b635a]">vermelha</strong> indica bloqueio manual
            só pela coluna <code className="rounded bg-[#f0ebe3] px-1">disponivel</code>. Só entradas{" "}
            <strong className="font-medium text-[#6b635a]">true</strong> aparecem em{" "}
            <code className="rounded bg-[#f0ebe3] px-1">n8n_cs_consultar_vagas</code>.
          </p>
        </footer>
      </div>
    </div>
  );
}
