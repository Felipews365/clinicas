"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Session = {
  id: string;
  phone: string;
  numero_cliente: string | null;
  needs_human: boolean;
  staff_handling: boolean;
  last_message_preview: string | null;
  updated_at: string;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
};

type Props = {
  supabase: SupabaseClient;
  clinicId: string;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

export function WhatsappInbox({ supabase, clinicId }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedSession = sessions.find((s) => s.id === selectedId) ?? null;

  // Carrega sessões
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    const { data } = await supabase
      .from("whatsapp_sessions")
      .select("id, phone, numero_cliente, needs_human, staff_handling, last_message_preview, updated_at")
      .eq("clinic_id", clinicId)
      .order("updated_at", { ascending: false })
      .limit(60);
    setLoadingSessions(false);
    if (data) setSessions(data as Session[]);
  }, [supabase, clinicId]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // Realtime: novas sessões
  useEffect(() => {
    const ch = supabase
      .channel(`wainbox-sessions-${clinicId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_sessions", filter: `clinic_id=eq.${clinicId}` },
        () => void loadSessions()
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [supabase, clinicId, loadSessions]);

  // Carrega mensagens ao selecionar sessão
  const loadMessages = useCallback(async (sessionId: string) => {
    setLoadingMessages(true);
    const { data } = await supabase
      .from("whatsapp_messages")
      .select("id, direction, body, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(100);
    setLoadingMessages(false);
    if (data) setMessages(data as Message[]);
  }, [supabase]);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  // Realtime: novas mensagens na sessão selecionada
  useEffect(() => {
    if (!selectedId) return;
    const ch = supabase
      .channel(`wainbox-msgs-${selectedId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_messages", filter: `session_id=eq.${selectedId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [supabase, selectedId]);

  // Scroll ao fundo quando chegam mensagens
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!selectedId || !input.trim() || sending) return;
    setSending(true);
    setSendError(null);
    const text = input.trim();
    setInput("");

    const res = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: selectedId, message: text }),
      credentials: "include",
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setSendError(json.error ?? `Erro ${res.status}`);
      setInput(text); // restaura o texto
    }
    setSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  // Agrupa mensagens por data para exibir separadores
  function groupByDate(msgs: Message[]) {
    const groups: { date: string; items: Message[] }[] = [];
    for (const msg of msgs) {
      const date = msg.created_at.slice(0, 10);
      const last = groups[groups.length - 1];
      if (last?.date === date) {
        last.items.push(msg);
      } else {
        groups.push({ date, items: [msg] });
      }
    }
    return groups;
  }

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden rounded-2xl border border-[#e6e1d8] bg-[#F9F7F2] shadow-sm">
      {/* Lista de sessões */}
      <div className="flex w-[240px] shrink-0 flex-col border-r border-[#e6e1d8] bg-white">
        <div className="border-b border-[#e6e1d8] px-4 py-3">
          <h2 className="font-display text-sm font-semibold text-[#2c2825]">Conversas</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingSessions ? (
            <p className="px-4 py-3 text-xs text-[#8a8278]">A carregar…</p>
          ) : sessions.length === 0 ? (
            <p className="px-4 py-3 text-xs text-[#8a8278]">Nenhuma conversa ainda.</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={`w-full border-b border-[#f0ece4] px-4 py-3 text-left transition-colors hover:bg-[#f7f4ee] ${
                  selectedId === s.id ? "bg-[#f0ece4]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  {s.needs_human && !s.staff_handling ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Pediu humano" />
                  ) : s.staff_handling ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#4D6D66]" title="Atendendo" />
                  ) : (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#c8c3bb]" title="Bot" />
                  )}
                  <span className="truncate text-xs font-semibold text-[#2c2825]">
                    {s.numero_cliente ?? s.phone}
                  </span>
                </div>
                {s.last_message_preview ? (
                  <p className="mt-0.5 line-clamp-1 text-xs text-[#8a8278]">
                    {s.last_message_preview}
                  </p>
                ) : null}
                <p className="mt-0.5 text-[10px] text-[#b0a99e]">
                  {formatDate(s.updated_at)}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Área de chat */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#e6e1d8] bg-white px-5 py-3">
          {selectedSession ? (
            <>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4D6D66] text-xs font-bold text-white">
                {(selectedSession.numero_cliente ?? selectedSession.phone).slice(-2)}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#2c2825]">
                  {selectedSession.numero_cliente ?? selectedSession.phone}
                </p>
                <p className="text-xs text-[#8a8278]">
                  {selectedSession.phone}
                  {selectedSession.staff_handling
                    ? " · Atendimento humano ativo"
                    : selectedSession.needs_human
                      ? " · Aguardando humano"
                      : " · Bot ativo"}
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-[#8a8278]">Selecione uma conversa</p>
          )}
        </div>

        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!selectedId ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-[#b0a99e]">Escolha uma conversa na lista</p>
            </div>
          ) : loadingMessages ? (
            <p className="text-center text-xs text-[#8a8278]">A carregar mensagens…</p>
          ) : messages.length === 0 ? (
            <p className="text-center text-xs text-[#b0a99e]">Sem histórico de mensagens.</p>
          ) : (
            <div className="space-y-4">
              {groupByDate(messages).map(({ date, items }) => (
                <div key={date}>
                  <div className="my-3 flex items-center gap-2">
                    <div className="h-px flex-1 bg-[#e6e1d8]" />
                    <span className="text-[10px] text-[#b0a99e]">
                      {formatDate(date + "T00:00:00")}
                    </span>
                    <div className="h-px flex-1 bg-[#e6e1d8]" />
                  </div>
                  <div className="space-y-2">
                    {items.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                            msg.direction === "outbound"
                              ? "rounded-br-sm bg-[#4D6D66] text-white"
                              : "rounded-bl-sm bg-white text-[#2c2825]"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                          <p
                            className={`mt-0.5 text-right text-[10px] ${
                              msg.direction === "outbound" ? "text-white/60" : "text-[#b0a99e]"
                            }`}
                          >
                            {formatTime(msg.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        {selectedId ? (
          <div className="border-t border-[#e6e1d8] bg-white px-4 py-3">
            {sendError ? (
              <p className="mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">
                {sendError}
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite a mensagem… (Enter para enviar)"
                rows={2}
                className="flex-1 resize-none rounded-xl border border-[#e6e1d8] bg-[#f9f7f2] px-3 py-2 text-sm text-[#2c2825] placeholder-[#b0a99e] outline-none focus:border-[#4D6D66]"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={sending || !input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#4D6D66] text-white hover:bg-[#3f5c56] disabled:opacity-40"
                title="Enviar"
              >
                {sending ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="animate-spin">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".3" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-[#b0a99e]">Shift+Enter para nova linha</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
