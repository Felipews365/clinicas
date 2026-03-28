export type PersonEmbed = { name: string | null; phone: string };
export type ProfessionalEmbed = { name: string; specialty: string | null };

export type AppointmentRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  service_name: string | null;
  status: "scheduled" | "cancelled" | "completed";
  source: string | null;
  notes: string | null;
  patients: PersonEmbed | PersonEmbed[] | null;
  professionals: ProfessionalEmbed | ProfessionalEmbed[] | null;
};

export const statusLabel: Record<AppointmentRow["status"], string> = {
  scheduled: "Agendado",
  cancelled: "Cancelado",
  completed: "Concluído",
};

/** Agendamento ativo marcado como confirmado no painel (`source = painel`). */
export function isClinicConfirmed(r: AppointmentRow): boolean {
  return r.status === "scheduled" && r.source === "painel";
}

/** Agendamento ativo ainda por confirmar (ex.: WhatsApp / n8n). */
export function awaitsConfirmation(r: AppointmentRow): boolean {
  return r.status === "scheduled" && r.source !== "painel";
}

export function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

export function formatRange(starts: string, ends: string) {
  const s = new Date(starts);
  const e = new Date(ends);
  const date = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(s);
  const tf = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} · ${tf.format(s)} – ${tf.format(e)}`;
}
