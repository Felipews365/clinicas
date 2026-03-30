"use client";

import { useEffect } from "react";
import type {
  AgendaNotificationItem,
  AgendaNotifPrefs,
} from "@/lib/agenda-notifications";
import type { AgendaToast } from "@/hooks/use-agenda-notifications";

function tipoAccent(tipo: AgendaNotificationItem["tipo"]) {
  if (tipo === "agendamento") {
    return {
      dot: "bg-[var(--primary)]",
      border: "border-l-[var(--primary)]",
    };
  }
  if (tipo === "cancelamento") {
    return {
      dot: "bg-red-500",
      border: "border-l-red-500",
    };
  }
  return {
    dot: "bg-amber-500",
    border: "border-l-amber-500",
  };
}

export function NotificationToastStack({
  toasts,
  dismissToast,
}: {
  toasts: AgendaToast[];
  dismissToast: (toastId: string) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-[90] flex flex-col gap-2 sm:bottom-6 sm:right-6"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div key={t.toastId} className="pointer-events-auto">
          <ToastCard item={t.item} onClose={() => dismissToast(t.toastId)} />
        </div>
      ))}
    </div>
  );
}

function ToastCard({
  item,
  onClose,
}: {
  item: AgendaNotificationItem;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 7500);
    return () => clearTimeout(t);
  }, [onClose]);

  const acc = tipoAccent(item.tipo);
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`flex max-w-xs min-w-[280px] items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 pr-3 shadow-xl animate-in slide-in-from-right-4 fade-in duration-300 border-l-4 ${acc.border}`}
    >
      <div
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${acc.dot}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--text)]">{item.titulo}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
          {item.mensagem}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="ml-1 shrink-0 rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export type NotificationAlertsPageProps = {
  onBack: () => void;
  prefs: AgendaNotifPrefs;
  updatePrefs: (p: AgendaNotifPrefs) => void;
  inbox: AgendaNotificationItem[];
  markAllRead: () => void;
  markOneRead: (id: string) => void;
  clearInbox: () => void;
  onNavigateAppointment?: (appointmentId: string, startsAtIso: string) => void;
  playTestSound: () => void;
  onFirstInteraction: () => void;
};

function toggleRow(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
  id: string
) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center justify-between gap-4 py-1"
    >
      <span className="text-sm text-[var(--text)]">{label}</span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 rounded border-[var(--border)] accent-[var(--primary)]"
      />
    </label>
  );
}

function fmtNotifShort(iso: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function clampVolumeUi(v: number): number {
  if (!Number.isFinite(v)) return 0.38;
  return Math.min(1, Math.max(0, v));
}

/** Página de alertas no fluxo principal do painel (sem modal). */
export function NotificationAlertsPage({
  onBack,
  prefs,
  updatePrefs,
  inbox,
  markAllRead,
  markOneRead,
  clearInbox,
  onNavigateAppointment,
  playTestSound,
  onFirstInteraction,
}: NotificationAlertsPageProps) {
  const soundOff = !prefs.soundEnabled;
  const volPercent = Math.round(clampVolumeUi(prefs.soundVolume) * 100);

  return (
    <div
      className="w-full max-w-none text-left"
      role="region"
      aria-labelledby="alerts-page-title"
    >
      <header className="mb-6 border-b border-[var(--border)] pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--primary)]">
          Painel
        </p>
        <h1
          id="alerts-page-title"
          className="font-display mt-2 text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl"
        >
          Alertas
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--text-muted)]">
          Veja o que chegou na agenda e ajuste avisos visuais e sonoros.
        </p>
      </header>

      <div className="mx-auto max-w-2xl space-y-8 pb-10">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Notificações recentes
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => markAllRead()}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-[11px] font-medium text-[var(--primary)] transition-colors hover:bg-[var(--sidebar-active)]"
              >
                Marcar lidas
              </button>
              <button
                type="button"
                onClick={() => clearInbox()}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-soft)]"
              >
                Limpar
              </button>
            </div>
          </div>
          <div className="max-h-[min(50vh,22rem)] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            {inbox.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                Nenhuma notificação neste dispositivo.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {inbox.map((n) => {
                  const acc = tipoAccent(n.tipo);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-soft)] ${
                          !n.lida ? "bg-[var(--sidebar-active)]/35" : ""
                        } border-l-[3px] ${acc.border}`}
                        onClick={() => {
                          markOneRead(n.id);
                          if (n.appointmentId && onNavigateAppointment) {
                            onNavigateAppointment(n.appointmentId, n.horario);
                          }
                        }}
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${acc.dot}`}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--text)]">
                            {n.titulo}
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
                            {n.mensagem}
                          </p>
                          <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                            {fmtNotifShort(n.horario)}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="space-y-3 border-t border-[var(--border)] pt-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Avisos
          </p>
          {toggleRow(
            "Aviso visual (pop-up)",
            prefs.visualAlertsEnabled,
            (v) => updatePrefs({ ...prefs, visualAlertsEnabled: v }),
            "alert-visual"
          )}
          {toggleRow(
            "Aviso sonoro",
            prefs.soundEnabled,
            (v) => updatePrefs({ ...prefs, soundEnabled: v }),
            "alert-sound"
          )}
          <div className={soundOff ? "pointer-events-none opacity-45" : ""}>
            <label
              htmlFor="alert-sound-type"
              className="mb-1.5 block text-xs text-[var(--text-muted)]"
            >
              Som do alerta
            </label>
            <select
              id="alert-sound-type"
              disabled={soundOff}
              value={prefs.soundVariant}
              onChange={(e) =>
                updatePrefs({
                  ...prefs,
                  soundVariant: e.target
                    .value as AgendaNotifPrefs["soundVariant"],
                })
              }
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)] outline-none ring-[var(--primary)] focus-visible:ring-2 disabled:cursor-not-allowed"
            >
              <option value="soft">Suave</option>
              <option value="chime">Toque</option>
            </select>
          </div>
          <div className={soundOff ? "pointer-events-none opacity-45" : ""}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="alert-volume"
                className="text-xs text-[var(--text-muted)]"
              >
                Volume
              </label>
              <span className="text-xs tabular-nums text-[var(--text-muted)]">
                {volPercent}%
              </span>
            </div>
            <input
              id="alert-volume"
              type="range"
              min={0}
              max={100}
              disabled={soundOff}
              value={volPercent}
              onChange={(e) =>
                updatePrefs({
                  ...prefs,
                  soundVolume: Number(e.target.value) / 100,
                })
              }
              className="h-2 w-full cursor-pointer accent-[var(--primary)] disabled:cursor-not-allowed"
            />
          </div>
          <button
            type="button"
            disabled={soundOff}
            onClick={() => {
              onFirstInteraction();
              playTestSound();
            }}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Testar som
          </button>
        </section>

        <section className="space-y-3 border-t border-[var(--border)] pt-8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Tipos de evento
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Escolha quais mudanças na agenda geram um alerta.
          </p>
          {(
            [
              ["agendamento", "Novo agendamento"],
              ["cancelamento", "Cancelamento"],
              ["reagendamento", "Reagendamento"],
            ] as const
          ).map(([key, label]) =>
            toggleRow(
              label,
              prefs[key],
              (v) => updatePrefs({ ...prefs, [key]: v }),
              `alert-event-${key}`
            )
          )}
        </section>
      </div>

      <div className="mt-10 flex justify-end border-t border-[var(--border)] pt-6">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-2.5 text-sm font-medium text-[var(--text-muted)] shadow-sm transition-colors hover:bg-[var(--surface-soft)]"
        >
          Voltar ao dashboard
        </button>
      </div>
    </div>
  );
}
