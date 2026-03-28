"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDaysToYmd,
  filterSlotRowsNotPastToday,
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
};

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  clinicId: string;
  /** YYYY-MM-DD — sincroniza com o dia escolhido no painel */
  dayKey: string;
  /** Quando hoje já não tem vagas úteis, avança o dia do painel (ex.: sábado à noite → segunda). */
  onAutoAdvanceDay?: (ymd: string) => void;
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
  return v as CsSlotRow[];
}

const MAX_DAYS_SCAN = 21;

export function SlotsManagerModal({
  open,
  onClose,
  supabase,
  clinicId,
  dayKey,
  onAutoAdvanceDay,
}: Props) {
  const [rows, setRows] = useState<CsSlotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Dia cuja lista está a ser mostrada (pode adiantar-se ao calendário se hoje já passou tudo). */
  const [viewDayKey, setViewDayKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setViewDayKey(null);
  }, [open]);

  const labelKey = viewDayKey ?? dayKey;
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
    if (!open || !dayKey) return;
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
      if (isYmdToday(dayKey)) {
        let k = dayKey;
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
            if (k !== dayKey) onAutoAdvanceDay?.(k);
            setViewDayKey(k);
            setRows(visible);
            return;
          }
          k = addDaysToYmd(k, 1);
        }
        setRows([]);
        return;
      }

      const { data, error: e } = await fetchDay(dayKey);
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
      setViewDayKey(dayKey);
      setRows(applyTimeFilter(data, dayKey));
    } finally {
      setLoading(false);
    }
  }, [open, dayKey, clinicId, supabase, onAutoAdvanceDay]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const byProf = useMemo(() => {
    const map = new Map<string, CsSlotRow[]>();
    for (const r of rows) {
      const list = map.get(r.profissional_id) ?? [];
      list.push(r);
      map.set(r.profissional_id, list);
    }
    return map;
  }, [rows]);

  async function toggleSlot(slot: CsSlotRow) {
    if (busyId) return;
    setBusyId(slot.horario_id);
    setError(null);
    const next = !slot.disponivel;
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
          ? { ...x, disponivel: next }
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
            <p id="slots-modal-desc" className="mt-1 text-sm text-[#6b635a]">
              Cada bloco alterna entre <strong className="font-medium">disponível</strong> (o
              agente oferece em <code className="rounded bg-[#f0ebe3] px-1 text-xs">consultar vagas</code>)
              e <strong className="font-medium">indisponível</strong> (não entra na lista). No{" "}
              <strong className="font-medium">dia de hoje</strong> só aparecem horários ainda por
              vir.{" "}
              <span className="capitalize">{dateLabel}</span>
              {labelKey !== dayKey ? (
                <span className="mt-1 block text-xs text-[#9a9278]">
                  (O calendário do painel foi ajustado para este dia — dias sem expediente na base são
                  ignorados.)
                </span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#dcd5ca] bg-white px-3 py-2 text-sm font-medium text-[#5c5348] hover:bg-[#f7f4ef]"
          >
            Fechar
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {!dayKey ? (
            <p className="text-sm text-[#7a7268]">Escolha uma data no painel.</p>
          ) : error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              {error}
            </p>
          ) : loading ? (
            <p className="text-sm text-[#7a7268]">A carregar horários…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm leading-relaxed text-[#6b635a]">
              {isYmdToday(dayKey) ? (
                <>
                  Não há horários futuros hoje (ou os blocos já passaram) e não foi encontrada agenda
                  nos próximos {MAX_DAYS_SCAN} dias em{" "}
                  <code className="rounded bg-[#f0ebe3] px-1 text-xs">cs_horarios_disponiveis</code>.
                  Confirme o seed/SQL, o <code className="rounded bg-[#f0ebe3] px-1 text-xs">clinic_id</code>{" "}
                  dos profissionais, ou escolha outra data no calendário.
                </>
              ) : (
                <>
                  Sem blocos de horário em <span className="font-medium">{dayKey}</span> na base{" "}
                  <code className="rounded bg-[#f0ebe3] px-1 text-xs">cs_horarios_disponiveis</code>.
                  Gere vagas pelo seed/SQL ou confirme se os profissionais têm{" "}
                  <code className="rounded bg-[#f0ebe3] px-1 text-xs">clinic_id</code> igual à sua
                  clínica.
                </>
              )}
            </p>
          ) : (
            <ul className="flex flex-col gap-6" role="list">
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
                      {slots.map((s) => {
                        const livre = s.disponivel;
                        const busy = busyId === s.horario_id;
                        return (
                          <button
                            key={s.horario_id}
                            type="button"
                            disabled={busy}
                            onClick={() => void toggleSlot(s)}
                            aria-pressed={!livre}
                            aria-label={`${s.horario} — ${
                              livre ? "disponível para o agente" : "indisponível para o agente"
                            }. Clicar para alternar.`}
                            title={
                              livre
                                ? "Marcar como indisponível (o agente deixa de listar)"
                                : "Marcar como disponível de novo"
                            }
                            className={`flex min-w-[5.5rem] flex-col items-stretch gap-0.5 rounded-xl px-3 py-2 text-sm font-semibold tabular-nums transition-[transform,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${
                              livre
                                ? "border border-[#c5ddd4] bg-[#f0faf6] text-[#1e4d40] shadow-sm hover:-translate-y-px focus-visible:outline-[#3d6b62]"
                                : "border border-[#e0d5cc] bg-[#f5f0eb] text-[#6b5344] line-through decoration-[#9a8678] hover:no-underline focus-visible:outline-[#8b735a]"
                            }`}
                          >
                            <span>{busy ? "…" : s.horario}</span>
                            <span
                              className={`text-[10px] font-medium uppercase tracking-wide ${
                                livre ? "text-[#3d6b62]/90" : "text-[#8b735a]"
                              }`}
                            >
                              {livre ? "Disponível" : "Indisponível"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="shrink-0 border-t border-[#ebe6dd] px-6 py-4">
          <p className="text-xs leading-relaxed text-[#8a8278]">
            O campo na base é <code className="rounded bg-[#f0ebe3] px-1">disponivel</code>:
            só entradas <strong className="font-medium text-[#6b635a]">true</strong> aparecem em{" "}
            <code className="rounded bg-[#f0ebe3] px-1">n8n_cs_consultar_vagas</code>. Marcar como
            indisponível bloqueia também o agendamento automático.
          </p>
        </footer>
      </div>
    </div>
  );
}
