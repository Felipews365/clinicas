/**
 * Textos WhatsApp enviados ao profissional (Evolution) — formato multilinha com emojis.
 */

/** YYYY-MM-DD → DD/MM/YYYY */
export function formatDateBrFromYmd(ymd: string | null | undefined): string {
  const s = String(ymd ?? "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s || "—";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Hora vinda da BD (time / string) → HH:mm */
export function formatHoraBr(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : s;
}

export function formatDateBrFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export function formatHoraBrFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** M = Dr., F = Dra.; null ou inválido = Dr. */
export type ProfissionalGenero = "M" | "F" | null;

export function normalizeProfissionalGenero(raw: unknown): ProfissionalGenero {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "F") return "F";
  if (s === "M") return "M";
  return null;
}

/** Evita «Dr. Dra. …» quando o nome já traz tratamento. */
function profissionalComTratamento(
  nome: string,
  genero: ProfissionalGenero,
): string {
  const n = nome.trim();
  if (!n) return "";
  if (/^dra\.?\s/i.test(n)) return n;
  if (/^dr\.?\s/i.test(n)) return n;
  const prefix = genero === "F" ? "Dra." : "Dr.";
  return `${prefix} ${n}`;
}

function linhaAberturaProfissional(
  profissional: string | null | undefined,
  profissionalGenero: ProfissionalGenero,
  comNome: (tratado: string) => string,
  semNome: string,
): string {
  const prof = (profissional ?? "").trim();
  if (!prof) return semNome;
  return comNome(profissionalComTratamento(prof, profissionalGenero));
}

/** Exibe número do cliente no aviso ao profissional (BR quando possível). */
export function formatTelefoneClienteNotificacao(
  raw: string | null | undefined,
): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  if (d.length < 10) return null;
  let x = d;
  if (x.startsWith("55") && x.length >= 12) x = x.slice(2);
  if (x.length === 11) {
    return `(${x.slice(0, 2)}) ${x.slice(2, 7)}-${x.slice(7)}`;
  }
  if (x.length === 10) {
    return `(${x.slice(0, 2)}) ${x.slice(2, 6)}-${x.slice(6)}`;
  }
  if (s.startsWith("+")) return s;
  return `+${d}`;
}

function blocoClienteENumero(
  cliente: string,
  clienteTelefone: string | null | undefined,
): string[] {
  const tel = formatTelefoneClienteNotificacao(clienteTelefone);
  const lines = [`👤 Cliente: ${cliente}`];
  if (tel) lines.push(`📱 Telefone: ${tel}`);
  return lines;
}

export function profWhatsAppNovoAgendamento(p: {
  profissional?: string | null;
  profissionalGenero?: ProfissionalGenero;
  cliente: string;
  /** Telefone do cliente (qualquer formato; normalizado na mensagem). */
  clienteTelefone?: string | null;
  servico: string;
  data: string;
  hora: string;
}): string {
  const gen = normalizeProfissionalGenero(p.profissionalGenero);
  const abertura = linhaAberturaProfissional(
    p.profissional,
    gen,
    (t) => `${t}, você tem um novo agendamento:`,
    "Você tem um novo agendamento:",
  );
  return [
    abertura,
    "",
    "🟢 Novo agendamento",
    "",
    ...blocoClienteENumero(p.cliente, p.clienteTelefone),
    `🩺 Serviço: ${p.servico}`,
    `📅 Data: ${p.data}`,
    `🕘 Horário: ${p.hora}`,
  ].join("\n");
}

export function profWhatsAppCancelamento(p: {
  profissional?: string | null;
  profissionalGenero?: ProfissionalGenero;
  cliente: string;
  clienteTelefone?: string | null;
  servico: string;
  data: string;
  hora: string;
}): string {
  const gen = normalizeProfissionalGenero(p.profissionalGenero);
  const abertura = linhaAberturaProfissional(
    p.profissional,
    gen,
    (t) => `${t}, você tem um cancelamento:`,
    "Você tem um cancelamento:",
  );
  return [
    abertura,
    "",
    "🔴 Cancelamento de agendamento",
    "",
    ...blocoClienteENumero(p.cliente, p.clienteTelefone),
    `🩺 Serviço: ${p.servico}`,
    `📅 Data: ${p.data}`,
    `🕘 Horário: ${p.hora}`,
  ].join("\n");
}

export function profWhatsAppReagendamento(p: {
  /** Nome do profissional (sem título obrigatório). */
  profissional?: string | null;
  profissionalGenero?: ProfissionalGenero;
  cliente: string;
  clienteTelefone?: string | null;
  servico: string;
  novaData: string;
  novoHorario: string;
}): string {
  const gen = normalizeProfissionalGenero(p.profissionalGenero);
  const abertura = linhaAberturaProfissional(
    p.profissional,
    gen,
    (t) => `${t}, você tem um reagendamento:`,
    "Você tem um reagendamento:",
  );
  return [
    abertura,
    "",
    "🟡 Reagendamento de agendamento",
    "",
    ...blocoClienteENumero(p.cliente, p.clienteTelefone),
    `🩺 Serviço: ${p.servico}`,
    `📅 Nova data: ${p.novaData}`,
    `🕙 Novo horário: ${p.novoHorario}`,
  ].join("\n");
}
