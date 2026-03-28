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
  formatRange,
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
    const title = profNm
      ? svc
        ? `${name} · ${profNm} · ${svc}`
        : `${name} · ${profNm}`
      : svc
        ? `${name} · ${svc}`
        : name;

    const palette =
      r.status === "scheduled"
        ? { bg: "#0d9488", border: "#0f766e" }
        : r.status === "cancelled"
          ? { bg: "#64748b", border: "#475569" }
          : { bg: "#059669", border: "#047857" };

    return {
      id: r.id,
      title,
      start: r.starts_at,
      end: r.ends_at,
      backgroundColor: palette.bg,
      borderColor: palette.border,
      classNames: r.status === "cancelled" ? ["fc-event-cancelled"] : [],
      extendedProps: {
        status: r.status,
        phone: patient?.phone,
        professional: prof?.name,
        specialty: prof?.specialty,
        service: r.service_name,
        source: r.source,
      },
    };
  });
}

type Props = {
  rows: AppointmentRow[];
  loading?: boolean;
  /** Sincroniza a data visível (ex.: seta dia anterior / seguinte no painel). */
  focusDate?: Date;
};

export function AppointmentsCalendar({ rows, loading, focusDate }: Props) {
  const [selected, setSelected] = useState<EventClickArg["event"] | null>(
    null
  );
  const calRef = useRef<FullCalendar | null>(null);

  const events = useMemo(() => rowsToEvents(rows), [rows]);

  useEffect(() => {
    if (!focusDate) return;
    const api = calRef.current?.getApi();
    if (api) api.gotoDate(focusDate);
  }, [focusDate]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          Legenda:
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: "#0d9488" }}
          />
          Agendado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: "#059669" }}
          />
          Concluído
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm opacity-60"
            style={{ background: "#64748b" }}
          />
          Cancelado
        </span>
      </div>

      <div className="fc-consultorio rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 md:p-4">
        {loading && !rows.length ? (
          <p className="py-16 text-center text-sm text-zinc-500">
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
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
            }}
            buttonText={{
              today: "Hoje",
              month: "Mês",
              week: "Semana",
              day: "Dia",
              list: "Lista",
            }}
            slotMinTime="07:00:00"
            slotMaxTime="21:00:00"
            slotDuration="00:30:00"
            allDaySlot={false}
            height="auto"
            contentHeight={640}
            nowIndicator
            dayHeaderFormat={{ weekday: "short", day: "numeric", month: "short" }}
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
              <div className="overflow-hidden px-0.5 py-0.5 leading-tight">
                <div className="text-[10px] font-semibold opacity-90">
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
        <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
              Detalhe do agendamento
            </h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Fechar
            </button>
          </div>
          <dl className="grid gap-2 text-zinc-700 dark:text-zinc-300">
            <div>
              <dt className="text-xs font-medium text-zinc-500">Quando</dt>
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
              <dt className="text-xs font-medium text-zinc-500">Estado</dt>
              <dd>
                {statusLabel[
                  (selected.extendedProps.status as AppointmentRow["status"]) ??
                    "scheduled"
                ] ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500">Telefone</dt>
              <dd className="font-mono text-xs">
                {(selected.extendedProps.phone as string) ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500">
                Profissional
              </dt>
              <dd>{(selected.extendedProps.professional as string) ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500">Serviço</dt>
              <dd>{(selected.extendedProps.service as string) ?? "—"}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
