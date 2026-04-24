export type PersonEmbed = { name: string | null; phone: string };
export type ProfessionalEmbed = {
  id?: string | null;
  name: string;
  specialty: string | null;
  /** M = Dr., F = Dra. em notificações; opcional. */
  gender?: string | null;
  /** Hex da paleta do painel (ex.: #E7F7EE); opcional em dados antigos. */
  panel_color?: string | null;
  /** Caminho no bucket `professional-avatars`. */
  avatar_path?: string | null;
  avatar_emoji?: string | null;
};

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

/**
 * Agendamento ativo já considerado confirmado na agenda:
 * marcado no painel, ou criado pelo agente/n8n em `cs_agendamentos` (id `cs:…`, fonte WhatsApp).
 */
export function isClinicConfirmed(r: AppointmentRow): boolean {
  if (r.status !== "scheduled") return false;
  if (r.source === "painel") return true;
  if (r.id.startsWith("cs:") && r.source === "whatsapp") return true;
  return false;
}

/** Agendamento ativo ainda por confirmar manualmente no painel. */
export function awaitsConfirmation(r: AppointmentRow): boolean {
  return r.status === "scheduled" && !isClinicConfirmed(r);
}

/** Criado pelo fluxo cs/n8n (agente IA/WhatsApp). */
export function isCsAgentBooking(r: AppointmentRow): boolean {
  return r.id.startsWith("cs:");
}

export function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}


/** Vários nomes a partir de `service_name` (separadores: `,` `;` `·` `/` ou quebra de linha). */
export function serviceNamesFromAppointment(
  service_name: string | null | undefined
): string[] {
  const raw = service_name?.trim();
  if (!raw) return [];
  return raw
    .split(/\s*[,;/]\s*|\s*·\s*|\n+/)
    .map((t) => t.trim())
    .filter(Boolean);
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
