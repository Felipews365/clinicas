"use client";

import {
  awaitsConfirmation,
  isClinicConfirmed,
  one,
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

function formatPhoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length >= 11 && phone.includes("55")) {
    const rest = d.slice(-11);
    return `(${rest.slice(0, 2)}) ${rest.slice(2, 7)}-${rest.slice(7)}`;
  }
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return phone || "—";
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

type Props = {
  rows: AppointmentRow[];
  busyId: string | null;
  onConfirm: (id: string) => void;
  onRemove: (id: string) => void;
};

export function AppointmentCardList({
  rows,
  busyId,
  onConfirm,
  onRemove,
}: Props) {
  return (
    <ul className="flex flex-col gap-5" aria-label="Lista de agendamentos do dia">
      {rows.map((r, index) => {
        const patient = one(r.patients);
        const prof = one(r.professionals);
        const name = patient?.name ?? "Paciente";
        const phone = patient?.phone ?? "—";
        const profName = prof?.name?.trim() || null;
        const profSpecialty = prof?.specialty?.trim() || null;
        const pending = r.status === "scheduled" && awaitsConfirmation(r);
        const confirmed = r.status === "scheduled" && isClinicConfirmed(r);
        const fromWhatsAppPending =
          pending && (r.source === "whatsapp" || r.id.startsWith("cs:"));

        const avatarClass =
          r.status === "cancelled"
            ? "bg-zinc-400"
            : pending
              ? colorForPending(r.id)
              : confirmed
                ? colorForConfirmed(r.id)
                : "bg-[#5f736e]";

        const staggerMs = Math.min(index, 14) * 52;

        return (
          <li
            key={r.id}
            className="agenda-animate-in list-none rounded-[1.35rem] border border-[#e8e2d9] bg-white/95 p-6 shadow-[0_1px_3px_rgba(44,40,37,0.06)] ring-1 ring-black/[0.03] transition-[box-shadow,transform] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-12px_rgba(44,40,37,0.18)] focus-within:ring-2 focus-within:ring-[#4D6D66]/25"
            style={{ animationDelay: `${staggerMs}ms` }}
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
                      <h2 className="font-display text-[1.35rem] font-semibold leading-snug tracking-tight text-[#1f1c1a]">
                        {name}
                      </h2>
                      {fromWhatsAppPending ? (
                        <p className="mt-1 text-xs font-medium text-[#7a7165]">
                          Origem: WhatsApp · aguarda confirmação da clínica
                        </p>
                      ) : r.status === "scheduled" &&
                        confirmed &&
                        (r.source === "whatsapp" || r.id.startsWith("cs:")) ? (
                        <p className="mt-1 text-xs font-medium text-[#7a7165]">
                          Origem: agente WhatsApp
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {r.status === "scheduled" && pending ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f0dcc8] bg-[#fff8f2] px-3.5 py-1.5 text-xs font-semibold text-[#9a4f1c]">
                          <IconHourglass className="text-[#c45c26]" />
                          Pendente
                        </span>
                      ) : r.status === "scheduled" && confirmed ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#c5ddd4] bg-[#f0faf6] px-3.5 py-1.5 text-xs font-semibold text-[#1e4d40]">
                          <IconCheck className="h-3.5 w-3.5 text-[#3d6b62]" />
                          Confirmado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3.5 py-1.5 text-xs font-semibold text-zinc-700">
                          {statusLabel[r.status]}
                        </span>
                      )}
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
                    <div className="flex items-start gap-3 rounded-xl bg-[#faf8f5] px-3 py-2.5">
                      <span className="mt-0.5 text-[#4D6D66]">
                        <IconCalendar className="opacity-90" />
                      </span>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#9a9288]">
                          Data
                        </dt>
                        <dd className="text-sm font-medium text-[#2c2825]" suppressHydrationWarning>
                          {formatDateLine(r.starts_at)}
                        </dd>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 rounded-xl bg-[#faf8f5] px-3 py-2.5">
                      <span className="mt-0.5 text-[#4D6D66]">
                        <IconClock className="opacity-90" />
                      </span>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#9a9288]">
                          Horário
                        </dt>
                        <dd className="text-sm font-medium tabular-nums text-[#2c2825]" suppressHydrationWarning>
                          {formatTimeLine(r.starts_at)}
                        </dd>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 rounded-xl bg-[#faf8f5] px-3 py-2.5 sm:col-span-2 lg:col-span-1">
                      <span className="mt-0.5 shrink-0 text-[#4D6D66]">
                        <IconStethoscope className="opacity-90" />
                      </span>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#9a9288]">
                          Profissional e serviço
                        </dt>
                        <dd className="text-sm font-medium text-[#2c2825]">
                          {profName ?? "Profissional"}
                          {profSpecialty && (
                            <span className="mt-0.5 block text-xs font-normal text-[#6b635a]">
                              {profSpecialty}
                            </span>
                          )}
                          {r.service_name && (
                            <span className="mt-0.5 block text-xs font-semibold text-[#4D6D66]">
                              {r.service_name}
                            </span>
                          )}
                        </dd>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 rounded-xl bg-[#faf8f5] px-3 py-2.5">
                      <span className="mt-0.5 text-[#4D6D66]">
                        <IconPhone className="opacity-90" />
                      </span>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#9a9288]">
                          Contacto
                        </dt>
                        <dd className="text-sm font-medium tabular-nums text-[#2c2825]">
                          {formatPhoneDisplay(phone)}
                        </dd>
                      </div>
                    </div>
                    {r.notes ? (
                      <div className="flex items-start gap-3 rounded-xl bg-[#faf8f5] px-3 py-2.5 sm:col-span-2">
                        <span className="mt-0.5 text-[#4D6D66]">
                          <IconChat className="opacity-90" />
                        </span>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#9a9288]">
                            Notas
                          </dt>
                          <dd className="line-clamp-3 text-sm leading-relaxed text-[#6b635a]">
                            {r.notes}
                          </dd>
                        </div>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </div>

              {r.status === "scheduled" ? (
                <div className="flex shrink-0 flex-row items-center justify-end gap-2 border-t border-[#efeae3] pt-4 lg:flex-col lg:items-stretch lg:justify-center lg:border-t-0 lg:border-l lg:border-[#efeae3] lg:pt-0 lg:pl-6">
                  {pending ? (
                    <button
                      type="button"
                      aria-label={`Confirmar agendamento de ${name}`}
                      disabled={busyId === r.id}
                      onClick={() => onConfirm(r.id)}
                      className="inline-flex h-11 min-w-[2.75rem] items-center justify-center rounded-xl bg-[#3d6b62] text-white shadow-sm transition-colors hover:bg-[#355a52] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3d6b62] disabled:opacity-50"
                    >
                      <IconCheck />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Cancelar agendamento de ${name}`}
                    disabled={busyId === r.id}
                    onClick={() => onRemove(r.id)}
                    className="group inline-flex h-11 min-w-[2.75rem] items-center justify-center rounded-xl border border-[#ddd8cf] bg-white text-[#5c5348] transition-colors hover:border-[#f0a8a8] hover:bg-[#fef2f2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a8278] disabled:opacity-50"
                  >
                    <IconTrash className="text-[#6b635a] transition-colors group-hover:text-[#dc2626]" />
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
