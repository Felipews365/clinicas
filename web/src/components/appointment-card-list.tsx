"use client";

import type { CSSProperties, ReactNode } from "react";
import { professionalCardCssVars } from "@/lib/professional-palette";
import { useDataTheme } from "@/lib/use-data-theme";
import {
  appointmentOriginLabel,
  awaitsConfirmation,
  isClinicConfirmed,
  isCsAgentBooking,
  one,
  serviceNamesFromAppointment,
  statusLabel,
  type AppointmentRow,
} from "@/types/appointments";

function initials(name: string | null | undefined): string {
  if (!name?.trim()) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function colorForPending(id: string): string {
  const palette = ["bg-[#c45c26]", "bg-[#b8753a]", "bg-[#a8552f]"];
  let h = 0;
  for (let i = 0; i < id.length; i++)
    h = (h + id.charCodeAt(i) * i) % palette.length;
  return palette[h] ?? palette[0];
}

function colorForConfirmed(id: string): string {
  const palette = ["bg-[#3d6b62]", "bg-[#355a52]", "bg-[#4a7c73]"];
  let h = 0;
  for (let i = 0; i < id.length; i++)
    h = (h + id.charCodeAt(i) * i) % palette.length;
  return palette[h] ?? palette[0];
}

function formatDateLine(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

function formatTimeLine(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function stripCountryCode(phone: string): string {
  const d = phone.replace(/\D/g, "");
  // Remove +55 Brazil country code when present (result must be 10 or 11 digits)
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d.slice(2);
  return d;
}

function formatPhoneDisplay(phone: string): string {
  const local = stripCountryCode(phone);
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return phone || "—";
}

function waHref(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length < 8) return null;
  const withCountry = d.startsWith("55") ? d : "55" + d;
  return `https://wa.me/${withCountry}`;
}

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function IconClock({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function IconStethoscope({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 4v6a6 6 0 0 0 12 0V4" />
      <path d="M12 16v4M10 20h4" />
      <circle cx="12" cy="10" r="2" />
    </svg>
  );
}

function IconPhone({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconChat({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

function IconHourglass({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
    </svg>
  );
}

function IconOrigin({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconProcedures({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.46.94 3.4 0l6.6-6.6c.94-.94.94-2.46 0-3.4L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  );
}

function AppointmentFieldSubCard({
  icon,
  label,
  children,
  className = "",
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 transition-[background-color,box-shadow] duration-200 ease-out hover:bg-[var(--surface-soft)] hover:shadow-[0_8px_28px_-14px_rgba(15,23,23,0.22)] dark:hover:shadow-[0_10px_32px_-14px_rgba(0,0,0,0.55)] " +
        className
      }
    >
      <span className="mt-0.5 shrink-0 text-[var(--primary)] [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:shrink-0">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </dt>
        <dd className="mt-1.5 min-w-0">{children}</dd>
      </div>
    </div>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

type Props = {
  rows: AppointmentRow[];
  busyId: string | null;
  onConfirm: (id: string) => void;
  onRemove: (id: string) => void;
  onReschedule: (row: AppointmentRow) => void;
};

export function AppointmentCardList({
  rows,
  busyId,
  onConfirm,
  onRemove,
  onReschedule,
}: Props) {
  const theme = useDataTheme();

  return (
    <ul className="flex flex-col gap-5" aria-label="Lista de agendamentos do dia">
      {rows.map((r, index) => {
        const patient = one(r.patients);
        const prof = one(r.professionals);
        const name = patient?.name ?? "Paciente";
        const phone = patient?.phone ?? "—";
        const phoneHref = waHref(phone);
        const profName = prof?.name?.trim() || null;
        const pending = r.status === "scheduled" && awaitsConfirmation(r);
        const confirmed = r.status === "scheduled" && isClinicConfirmed(r);
        const fromAgentIa = isCsAgentBooking(r);
        const fromWhatsAppPending =
          pending && (r.source === "whatsapp" || r.id.startsWith("cs:"));
        const serviceNames = serviceNamesFromAppointment(r.service_name);

        const avatarClass =
          r.status === "cancelled"
            ? "bg-[var(--text-muted)]"
            : pending
              ? colorForPending(r.id)
              : confirmed
                ? colorForConfirmed(r.id)
                : "bg-[var(--primary-strong)]";

        const staggerMs = Math.min(index, 14) * 52;
        const profColor = prof?.panel_color ?? null;
        const cardStyle = {
          animationDelay: `${staggerMs}ms`,
          ...professionalCardCssVars(profColor, r.id, theme),
        } as CSSProperties;

        return (
          <li
            id={`appointment-card-${r.id}`}
            key={r.id}
            data-professional-color={profColor ?? ""}
            className="patient-card agenda-animate-in list-none p-6 shadow-[var(--shadow-card)] ring-1 ring-[var(--text)]/[0.06] transition-[box-shadow,transform] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] focus-within:ring-2 focus-within:ring-[var(--primary)]/25"
            style={cardStyle}
          >
            <article className="flex flex-col gap-5 lg:flex-row lg:items-stretch lg:justify-between lg:gap-6">
              <div className="flex min-w-0 flex-1 gap-5">
                <div
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-base font-bold tracking-tight text-white shadow-inner ${avatarClass}`}
                  aria-hidden
                >
                  {initials(name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-display text-[1.35rem] font-semibold leading-snug tracking-tight text-[var(--text)]">
                        {name}
                      </h2>
                      {fromWhatsAppPending ? (
                        <p className="mt-1 text-xs font-medium text-[var(--text-muted)]">
                          {fromAgentIa
                            ? "Agendamento IA · aguarda confirmação da clínica"
                            : "Origem: WhatsApp · aguarda confirmação da clínica"}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <span
                        className="prof-card-badge truncate"
                        title={profName ?? undefined}
                      >
                        {profName ?? "Sem profissional"}
                      </span>
                      {r.status === "scheduled" && pending ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3.5 py-1.5 text-xs font-semibold text-[var(--warning-text)]">
                          <IconHourglass className="text-[var(--warning-icon)]" />
                          Pendente
                        </span>
                      ) : r.status === "scheduled" && confirmed ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--success-soft)] px-3.5 py-1.5 text-xs font-semibold text-[var(--success-text)]">
                          <IconCheck className="h-3.5 w-3.5 text-[var(--primary)]" />
                          Confirmado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-soft)] px-3.5 py-1.5 text-xs font-semibold text-[var(--text-muted)]">
                          {statusLabel[r.status]}
                        </span>
                      )}
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
                    <AppointmentFieldSubCard icon={<IconCalendar />} label="Data">
                      <span
                        className="text-base font-bold leading-snug text-[var(--text)]"
                        suppressHydrationWarning
                      >
                        {formatDateLine(r.starts_at)}
                      </span>
                    </AppointmentFieldSubCard>
                    <AppointmentFieldSubCard icon={<IconClock />} label="Horário">
                      <span
                        className="text-base font-bold tabular-nums leading-snug text-[var(--text)]"
                        suppressHydrationWarning
                      >
                        {formatTimeLine(r.starts_at)}
                      </span>
                    </AppointmentFieldSubCard>
                    <AppointmentFieldSubCard
                      icon={<IconStethoscope />}
                      label="Profissional"
                      className="sm:col-span-2 lg:col-span-1"
                    >
                      <span className="block text-base font-bold leading-snug text-[var(--text)]">
                        {profName ?? "Profissional"}
                      </span>
                    </AppointmentFieldSubCard>
                    <AppointmentFieldSubCard icon={<IconOrigin />} label="Origem">
                      <span
                        className={
                          "block text-base font-bold leading-snug " +
                          (fromAgentIa ? "text-[var(--primary)]" : "text-[var(--text)]")
                        }
                      >
                        {appointmentOriginLabel(r)}
                      </span>
                    </AppointmentFieldSubCard>
                    {serviceNames.length > 0 ? (
                      <AppointmentFieldSubCard
                        icon={<IconProcedures />}
                        label="Procedimentos"
                        className="sm:col-span-2 lg:col-span-1"
                      >
                        <div className="flex flex-wrap gap-1">
                          {serviceNames.map((proc: string, idx: number) => (
                            <span
                              key={`${r.id}-svc-${idx}`}
                              className="inline-flex items-center gap-1 rounded-md border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-xs font-medium text-teal-400"
                            >
                              <span className="text-[10px] leading-none" aria-hidden>
                                🦷
                              </span>
                              {proc}
                            </span>
                          ))}
                        </div>
                      </AppointmentFieldSubCard>
                    ) : null}
                    <AppointmentFieldSubCard icon={<IconPhone />} label="Contacto">
                      {phoneHref ? (
                        <a
                          href={phoneHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-base font-bold tabular-nums leading-snug text-[var(--text)] transition-colors hover:text-[#25d366] hover:underline"
                        >
                          {formatPhoneDisplay(phone)}
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="shrink-0 opacity-60">
                            <path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.12.55 4.18 1.6 6L0 24l6.18-1.62A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.19-1.25-6.21-3.48-8.52ZM12 22c-1.85 0-3.66-.5-5.23-1.44l-.37-.22-3.88 1.02 1.04-3.8-.24-.38A9.95 9.95 0 0 1 2 12C2 6.47 6.47 2 12 2a9.95 9.95 0 0 1 7.07 2.93A9.95 9.95 0 0 1 22 12c0 5.53-4.47 10-10 10Z"/>
                          </svg>
                        </a>
                      ) : (
                        <span className="text-base font-bold tabular-nums leading-snug text-[var(--text)]">
                          {formatPhoneDisplay(phone)}
                        </span>
                      )}
                    </AppointmentFieldSubCard>
                    {r.notes ? (
                      <AppointmentFieldSubCard
                        icon={<IconChat />}
                        label="Notas"
                        className="sm:col-span-2"
                      >
                        <span className="line-clamp-3 text-sm font-normal leading-relaxed text-[var(--text-muted)]">
                          {r.notes}
                        </span>
                      </AppointmentFieldSubCard>
                    ) : null}
                  </dl>
                </div>
              </div>

              {r.status === "scheduled" ? (
                <div className="flex shrink-0 flex-row items-center justify-end gap-2 border-t border-[var(--border)] pt-4 lg:flex-col lg:items-stretch lg:justify-center lg:border-t-0 lg:border-l lg:border-[var(--border)] lg:pt-0 lg:pl-6">
                  {pending ? (
                    <button
                      type="button"
                      aria-label={`Confirmar agendamento de ${name}`}
                      disabled={busyId === r.id}
                      onClick={() => onConfirm(r.id)}
                      className="inline-flex h-11 min-w-[2.75rem] items-center justify-center rounded-xl bg-[var(--primary)] text-white shadow-sm transition-colors hover:bg-[var(--primary-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-50"
                    >
                      <IconCheck />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Alterar horário de ${name}`}
                    disabled={busyId === r.id}
                    onClick={() => onReschedule(r)}
                    className="inline-flex h-11 min-w-[2.75rem] shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--primary)] transition-[background-color,border-color,color] duration-200 hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-50"
                  >
                    <IconPencil className="h-[18px] w-[18px] shrink-0" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Cancelar agendamento de ${name}`}
                    disabled={busyId === r.id}
                    onClick={() => onRemove(r.id)}
                    className="inline-flex h-11 min-w-[2.75rem] shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition-[background-color,border-color,color] duration-200 hover:border-red-500/40 hover:bg-red-500/20 hover:text-[var(--danger-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-muted)] disabled:opacity-50"
                  >
                    <IconTrash className="h-[18px] w-[18px] shrink-0" />
                  </button>
                </div>
              ) : null}
            </article>
          </li>
        );
      })}
    </ul>
  );
}
