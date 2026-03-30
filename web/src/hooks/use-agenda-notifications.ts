"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AgendaNotificationItem,
  type AgendaNotifPrefs,
  AGENDA_NOTIF_MAX_INBOX,
  DEFAULT_AGENDA_NOTIF_PREFS,
  loadAgendaNotifInbox,
  loadAgendaNotifPrefs,
  playAgendaNotificationSound,
  primeAgendaNotificationAudio,
  saveAgendaNotifInbox,
  saveAgendaNotifPrefs,
  shouldDeliverAgendaNotification,
} from "@/lib/agenda-notifications";

export type AgendaToast = { toastId: string; item: AgendaNotificationItem };

type AddInput = Omit<AgendaNotificationItem, "id" | "lida"> & {
  appointmentId?: string;
};

export function useAgendaNotifications() {
  const [prefs, setPrefs] = useState<AgendaNotifPrefs>(
    DEFAULT_AGENDA_NOTIF_PREFS
  );
  const [inbox, setInbox] = useState<AgendaNotificationItem[]>([]);
  const [toasts, setToasts] = useState<AgendaToast[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    setPrefs(loadAgendaNotifPrefs());
    setInbox(loadAgendaNotifInbox());
    setHydrated(true);
  }, []);

  const updatePrefs = useCallback((next: AgendaNotifPrefs) => {
    setPrefs(next);
    saveAgendaNotifPrefs(next);
  }, []);

  const unreadCount = useMemo(
    () => inbox.filter((x) => !x.lida).length,
    [inbox]
  );

  const addNotification = useCallback((input: AddInput) => {
    const p = prefsRef.current;
    if (!shouldDeliverAgendaNotification(input.tipo, p)) return;

    const item: AgendaNotificationItem = {
      id: crypto.randomUUID(),
      lida: false,
      titulo: input.titulo,
      mensagem: input.mensagem,
      horario: input.horario,
      tipo: input.tipo,
      appointmentId: input.appointmentId,
    };

    setInbox((prev) => {
      const next = [item, ...prev].slice(0, AGENDA_NOTIF_MAX_INBOX);
      saveAgendaNotifInbox(next);
      return next;
    });

    playAgendaNotificationSound(p);

    if (p.visualAlertsEnabled) {
      setToasts((prev) =>
        [...prev, { toastId: crypto.randomUUID(), item }].slice(-5)
      );
    }
  }, []);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((prev) => prev.filter((t) => t.toastId !== toastId));
  }, []);

  const markAllRead = useCallback(() => {
    setInbox((prev) => {
      const next = prev.map((x) => ({ ...x, lida: true }));
      saveAgendaNotifInbox(next);
      return next;
    });
  }, []);

  const markOneRead = useCallback((id: string) => {
    setInbox((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, lida: true } : x));
      saveAgendaNotifInbox(next);
      return next;
    });
  }, []);

  const clearInbox = useCallback(() => {
    setInbox([]);
    saveAgendaNotifInbox([]);
  }, []);

  const playTestSound = useCallback(() => {
    playAgendaNotificationSound(prefsRef.current);
  }, []);

  const onFirstBellInteraction = useCallback(() => {
    primeAgendaNotificationAudio(prefsRef.current);
  }, []);

  return {
    hydrated,
    prefs,
    updatePrefs,
    inbox,
    unreadCount,
    addNotification,
    toasts,
    dismissToast,
    markAllRead,
    markOneRead,
    clearInbox,
    playTestSound,
    onFirstBellInteraction,
  };
}
