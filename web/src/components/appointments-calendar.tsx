"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EventClickArg, EventInput } from "@fullcalendar/core";
import ptBrLocale from "@fullcalendar/core/locales/pt-br";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import {
  mixWithWhite,
  resolveProfessionalCardStyle,
} from "@/lib/professional-palette";
import {
  formatRange,
  isCsAgentBooking,
  one,
  statusLabel,
  type AppointmentRow,
} from "@/types/appointments";
import "./appointments-calendar.css";

function rowsToEvents(rows: AppointmentRow[]): EventInput[] {
  return rows.map((r) => {
    const patient = one(r.patients);
    const prof = one(r.professionals);
    const name = patient?.name?.trim() || "Paciente";
    const profNm = prof?.name?.trim() || "";
    const svc = r.service_name?.trim();
    const ia = isCsAgentBooking(r);
    const svcPart = ia
      ? svc
        ? `Agendamento IA · ${svc}`
        : "Agendamento IA"
      : svc ?? "";
    const title = profNm
      ? svcPart
        ? `${name} · ${profNm} · ${svcPart}`
        : `${name} · ${profNm}`
      : svcPart
        ? `${name} · ${svcPart}`
        : name;

    const palette =
      r.status === "cancelled"
        ? { bg: "#f1f3f4", border: "#80868b", text: "#5f6368" }
        : (() => {
            const s = resolveProfessionalCardStyle(
              prof?.panel_color ?? null,
              r.id
            );
            if (r.status === "completed") {
              return {
                bg: mixWithWhite(s.accent, 0.5),
                border: s.calendarBorder,
                text: s.calendarText,
              };
            }
            return {
              bg: s.calendarBg,
              border: s.calendarBorder,
              text: s.calendarText,
            };
          })();

    return {
      id: r.id,
      title,
      start: r.starts_at,
      end: r.ends_at,
      backgroundColor: palette.bg,
      borderColor: palette.border,
      textColor: palette.text,
      classNames: r.status === "cancelled" ? ["fc-event-cancelled"] : [],
      extendedProps: {
        status: r.status,
        phone: patient?.phone,
        professional: prof?.name,
        specialty: prof?.specialty,
        service: r.service_name,
        source: r.source,
        agentIa: ia,
      },
    };
  });
}

type Props = {
  rows: AppointmentRow[];
  loading?: boolean;
  /** Sincroniza a data visível (ex.: seta dia anterior / seguinte no painel). */
  focusDate?: Date;
  /** Limites do eixo de tempo (ex. a partir de `clinics.agenda_visible_hours`). */
  slotMinTime?: string;
  slotMaxTime?: string;
};

function dayHeaderGoogle(arg: {
  date: Date;
  isToday: boolean;
}) {
  const wd = arg.date
    .toLocaleDateString("pt-BR", { weekday: "short" })
    .replace(/\.$/, "")
    .toUpperCase();
  const num = arg.date.getDate();

  return (
    <div className="flex flex-col items-center gap-1 py-2.5">
      <span className="text-[10px] font-medium leading-none tracking-wide text-[#70757a] dark:text-[#9aa0a6]">
        {wd}
      </span>
      <span
        className={
          arg.isToday
            ? "flex h-9 w-9 items-center justify-center rounded-full bg-[#1a73e8] text-sm font-medium text-white shadow-sm"
            : "flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium text-[#3c4043] transition-colors hover:bg-[#f1f3f4] dark:text-[#e8eaed] dark:hover:bg-[#3c4043]"
        }
      >
        {num}
      </span>
    </div>
  );
}

export function AppointmentsCalendar({
  rows,
  loading,
  focusDate,
  slotMinTime = "06:00:00",
  slotMaxTime = "23:00:00",
}: Props) {
  const [selected, setSelected] = useState<EventClickArg["event"] | null>(
    null
  );
  const [compactToolbar, setCompactToolbar] = useState(false);
  const calRef = useRef<FullCalendar | null>(null);

  const events = useMemo(() => rowsToEvents(rows), [rows]);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    const apply = () => setCompactToolbar(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!focusDate) return;
    const api = calRef.current?.getApi();
    if (api) api.gotoDate(focusDate);
  }, [focusDate]);

  const headerToolbar = compactToolbar
    ? {
        left: "prev",
        center: "title",
        right: "next today",
      }
    : {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
      };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[#e8eaed] bg-[#f8f9fa] px-3 py-2.5 text-xs text-[#5f6368] dark:border-[#3c4043] dark:bg-[#292a2d] dark:text-[#9aa0a6]">
        <span className="font-medium text-[#3c4043] dark:text-[#e8eaed]">
          Legenda
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex gap-0.5" aria-hidden>
            <span className="inline-block h-2 w-2 rounded-full bg-[#DCEEFF]" />
            <span className="inline-block h-2 w-2 rounded-full bg-[#E7F7EE]" />
            <span className="inline-block h-2 w-2 rounded-full bg-[#F0E8FF]" />
          </span>
          Agendado · cor do profissional
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full border border-[#80868b]/40 bg-[#eceff1]"
            aria-hidden
          />
          Concluído · mesma família de cor
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full border-2 border-[#80868b] bg-[#f1f3f4]"
            aria-hidden
          />
          Cancelado
        </span>
      </div>

      <div className="fc-consultorio overflow-hidden rounded-xl border border-[#dadce0] bg-white shadow-[0_1px_2px_rgba(60,64,67,0.12)] dark:border-[#3c4043] dark:bg-[#202124] md:rounded-2xl">
        {loading && !rows.length ? (
          <p className="py-16 text-center text-sm text-[#5f6368]">
            A carregar calendário…
          </p>
        ) : (
          <FullCalendar
            ref={calRef}
            plugins={[
              dayGridPlugin,
              timeGridPlugin,
              listPlugin,
              interactionPlugin,
            ]}
            locale={ptBrLocale}
            initialView="timeGridWeek"
            headerToolbar={headerToolbar}
            buttonText={{
              today: "Hoje",
              month: "Mês",
              week: "Semana",
              day: "Dia",
              list: "Lista",
            }}
            slotMinTime={slotMinTime}
            slotMaxTime={slotMaxTime}
            slotDuration="00:30:00"
            slotLabelInterval="01:00:00"
            allDaySlot={false}
            height="auto"
            contentHeight={compactToolbar ? 520 : 720}
            expandRows
            nowIndicator
            dayHeaderContent={(arg) => dayHeaderGoogle(arg)}
            slotLabelFormat={{
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }}
            events={events}
            eventClick={(info) => {
              setSelected(info.event);
            }}
            eventContent={(arg) => (
              <div className="overflow-hidden px-0.5 py-0.5 leading-snug">
                <div className="text-[10px] font-semibold leading-tight opacity-90">
                  {arg.timeText}
                </div>
                <div className="truncate text-[11px] font-medium">
                  {arg.event.title}
                </div>
              </div>
            )}
          />
        )}
      </div>

      {selected ? (
        <div className="rounded-xl border border-[#dadce0] bg-white p-4 text-sm shadow-sm dark:border-[#3c4043] dark:bg-[#202124]">
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="font-semibold text-[#3c4043] dark:text-[#e8eaed]">
              Detalhe do agendamento
            </h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-[#5f6368] hover:bg-[#f1f3f4] dark:hover:bg-[#3c4043]"
            >
              Fechar
            </button>
          </div>
          <dl className="grid gap-2 text-[#3c4043] dark:text-[#e8eaed]">
            <div>
              <dt className="text-xs font-medium text-[#70757a]">Quando</dt>
              <dd>
                {selected.start && selected.end
                  ? formatRange(
                      selected.start.toISOString(),
                      selected.end.toISOString()
                    )
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-[#70757a]">Estado</dt>
              <dd>
                {statusLabel[
                  (selected.extendedProps.status as AppointmentRow["status"]) ??
                    "scheduled"
                ] ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-[#70757a]">Telefone</dt>
              <dd className="font-mono text-xs">
                {(selected.extendedProps.phone as string) ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-[#70757a]">
                Profissional
              </dt>
              <dd>{(selected.extendedProps.professional as string) ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-[#70757a]">Serviço</dt>
              <dd>
                {selected.extendedProps.agentIa
                  ? selected.extendedProps.service
                    ? `Agendamento IA · ${String(selected.extendedProps.service)}`
                    : "Agendamento IA"
                  : ((selected.extendedProps.service as string) ?? "—")}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
