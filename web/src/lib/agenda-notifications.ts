/**
 * Preferências e persistência da central de notificações do painel.
 * Sons estáticos em /public/sounds/*.wav
 */

export type AgendaNotificationTipo =
  | "agendamento"
  | "cancelamento"
  | "reagendamento";

export type AgendaNotificationItem = {
  id: string;
  tipo: AgendaNotificationTipo;
  titulo: string;
  mensagem: string;
  horario: string;
  lida: boolean;
  appointmentId?: string;
};

export type AgendaNotifPrefs = {
  agendamento: boolean;
  cancelamento: boolean;
  reagendamento: boolean;
  /** Pop-ups de alerta no canto do ecrã */
  visualAlertsEnabled: boolean;
  soundEnabled: boolean;
  soundVariant: "soft" | "chime";
  /** 0–1 */
  soundVolume: number;
};

const PREFS_KEY = "agenda-notif-prefs-v1";
const INBOX_KEY = "agenda-notif-inbox-v1";
export const AGENDA_NOTIF_MAX_INBOX = 100;

export const NOTIFICATION_SOUNDS: Record<
  AgendaNotifPrefs["soundVariant"],
  string
> = {
  soft: "/sounds/soft.wav",
  chime: "/sounds/chime.wav",
};

export const DEFAULT_AGENDA_NOTIF_PREFS: AgendaNotifPrefs = {
  agendamento: true,
  cancelamento: true,
  reagendamento: true,
  visualAlertsEnabled: true,
  soundEnabled: true,
  soundVariant: "soft",
  soundVolume: 0.38,
};

function clampVolume(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return DEFAULT_AGENDA_NOTIF_PREFS.soundVolume;
  return Math.min(1, Math.max(0, n));
}

export function loadAgendaNotifPrefs(): AgendaNotifPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_AGENDA_NOTIF_PREFS };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_AGENDA_NOTIF_PREFS };
    const p = JSON.parse(raw) as Partial<AgendaNotifPrefs>;
    const merged = { ...DEFAULT_AGENDA_NOTIF_PREFS, ...p };
    merged.soundVolume = clampVolume(merged.soundVolume);
    if (typeof merged.visualAlertsEnabled !== "boolean") {
      merged.visualAlertsEnabled = DEFAULT_AGENDA_NOTIF_PREFS.visualAlertsEnabled;
    }
    if (merged.soundVariant !== "soft" && merged.soundVariant !== "chime") {
      merged.soundVariant = DEFAULT_AGENDA_NOTIF_PREFS.soundVariant;
    }
    return merged;
  } catch {
    return { ...DEFAULT_AGENDA_NOTIF_PREFS };
  }
}

export function saveAgendaNotifPrefs(p: AgendaNotifPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

export function loadAgendaNotifInbox(): AgendaNotificationItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(INBOX_KEY);
    if (!raw) return [];
    const a = JSON.parse(raw) as AgendaNotificationItem[];
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export function saveAgendaNotifInbox(items: AgendaNotificationItem[]): void {
  localStorage.setItem(
    INBOX_KEY,
    JSON.stringify(items.slice(0, AGENDA_NOTIF_MAX_INBOX))
  );
}

export function shouldDeliverAgendaNotification(
  tipo: AgendaNotificationTipo,
  prefs: AgendaNotifPrefs
): boolean {
  if (tipo === "agendamento") return prefs.agendamento;
  if (tipo === "cancelamento") return prefs.cancelamento;
  return prefs.reagendamento;
}

/** Primeira interação do utilizador: desbloqueia Audio no browser. */
export function primeAgendaNotificationAudio(prefs: AgendaNotifPrefs): void {
  if (typeof window === "undefined" || !prefs.soundEnabled) return;
  const src = NOTIFICATION_SOUNDS[prefs.soundVariant] ?? NOTIFICATION_SOUNDS.soft;
  const vol = clampVolume(prefs.soundVolume);
  try {
    const a = new Audio(src);
    a.volume = Math.min(0.06, Math.max(0.01, vol * 0.12));
    void a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

export function playAgendaNotificationSound(prefs: AgendaNotifPrefs): void {
  if (typeof window === "undefined" || !prefs.soundEnabled) return;
  const src = NOTIFICATION_SOUNDS[prefs.soundVariant] ?? NOTIFICATION_SOUNDS.soft;
  const vol = clampVolume(prefs.soundVolume);
  try {
    const audio = new Audio(src);
    audio.volume = vol;
    void audio.play().catch(() => fallbackSyntheticChime(vol));
  } catch {
    fallbackSyntheticChime(vol);
  }
}

function fallbackSyntheticChime(volume: number): void {
  const peak = Math.min(0.22, Math.max(0.02, volume * 0.45));
  try {
    const ctx = new AudioContext();
    const playTone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(peak, ctx.currentTime + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + start + dur
      );
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    playTone(880, 0, 0.14);
    playTone(1100, 0.1, 0.18);
    void ctx.resume();
  } catch {
    /* */
  }
}
