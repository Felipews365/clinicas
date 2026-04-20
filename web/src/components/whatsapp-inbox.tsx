"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── tipos ────────────────────────────────────────────────────────────────────

type HistRow = {
  id: number;
  session_id: string;
  message: { type: "human" | "ai"; content: string };
};

type ClientRow = {
  telefone: string;
  nome: string;
  bot_ativo: boolean;
};

type SessionInfo = {
  sessionId: string;
  phone: string;
  clientName: string | null;
  botAtivo: boolean;
  lastPreview: string;
  lastId: number;
};

type Props = { supabase: SupabaseClient; clinicId: string };

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Extrai o telefone do session_id ("clinic_id:phone@s.whatsapp.net" → "phone") */
function parsePhone(sessionId: string): string {
  const after = sessionId.split(":").slice(1).join(":");
  return after.split("@")[0] ?? after;
}

/** Normaliza telefone para comparação (só dígitos, sem DDI 55 se tiver 13+ dígitos) */
function normPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length >= 13 ? d.slice(2) : d;
}

/** Converte o conteúdo de uma mensagem humana (pode ser JSON {"msg":"..."}) em texto legível */
function parseHumanContent(content: string): string {
  const lines = content.split("\n").filter(Boolean);
  const parts: string[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const msg = obj.msg ?? obj.text ?? obj.message;
      if (typeof msg === "string") { parts.push(msg); continue; }
    } catch { /* não é JSON */ }
    parts.push(line);
  }
  return parts.join("\n") || content;
}

function parseContent(message: HistRow["message"]): string {
  if (message.type === "human") return parseHumanContent(message.content);
  return message.content;
}

function formatTime(ts: string | number) {
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts: string | number) {
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

// ─── componente ───────────────────────────────────────────────────────────────

export function WhatsappInbox({ supabase, clinicId }: Props) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<HistRow[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedSession = sessions.find((s) => s.sessionId === selectedId) ?? null;

  // ── carrega sessões ──────────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);

    const [{ data: histRows }, { data: clients }] = await Promise.all([
      supabase
        .from("n8n_chat_histories")
        .select("id, session_id, message")
        .like("session_id", `${clinicId}:%`)
        .order("id", { ascending: false })
        .limit(2000),
      supabase
        .from("cs_clientes")
        .select("telefone, nome, bot_ativo")
        .eq("clinic_id", clinicId),
    ]);

    setLoadingSessions(false);
    if (!histRows?.length) return;

    const clientList = (clients ?? []) as ClientRow[];

    // agrupa por session_id mantendo apenas o mais recente de cada
    const map = new Map<string, SessionInfo>();
    for (const row of histRows as HistRow[]) {
      if (map.has(row.session_id)) continue;
      const phone = parsePhone(row.session_id);
      const np = normPhone(phone);
      const client = clientList.find((c) => normPhone(c.telefone) === np);
      map.set(row.session_id, {
        sessionId: row.session_id,
        phone,
        clientName: client?.nome?.trim() || null,
        botAtivo: client?.bot_ativo ?? true,
        lastPreview: parseContent(row.message),
        lastId: row.id,
      });
    }

    setSessions([...map.values()].sort((a, b) => b.lastId - a.lastId));
  }, [supabase, clinicId]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  // ── realtime: novas mensagens ────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel(`wainbox-hist-${clinicId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "n8n_chat_histories" },
        (payload) => {
          const row = payload.new as HistRow;
          if (!row.session_id.startsWith(clinicId)) return;
          void loadSessions();
          if (row.session_id === selectedId) {
            setMessages((prev) => [...prev, row]);
          }
        }
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [supabase, clinicId, loadSessions, selectedId]);

  // ── carrega mensagens ao selecionar sessão ───────────────────────────────
  const loadMessages = useCallback(
    async (sessionId: string) => {
      setLoadingMessages(true);
      const { data } = await supabase
        .from("n8n_chat_histories")
        .select("id, session_id, message")
        .eq("session_id", sessionId)
        .order("id", { ascending: true })
        .limit(300);
      setLoadingMessages(false);
      if (data) setMessages(data as HistRow[]);
    },
    [supabase]
  );

  useEffect(() => {
    if (!selectedId) { setMessages([]); return; }
    void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  // scroll ao fundo
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── enviar mensagem ──────────────────────────────────────────────────────
  async function sendMessage() {
    if (!selectedId || !input.trim() || sending) return;
    setSending(true);
    setSendError(null);
    const text = input.trim();
    setInput("");

    const res = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: selectedSession?.phone,
        clinic_id: clinicId,
        message: text,
      }),
      credentials: "include",
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setSendError(json.error ?? `Erro ${res.status}`);
      setInput(text);
    }
    setSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden rounded-2xl border border-[#e6e1d8] bg-[#F9F7F2] shadow-sm">

      {/* Lista de sessões */}
      <div className="flex w-[260px] shrink-0 flex-col border-r border-[#e6e1d8] bg-white">
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
                key={s.sessionId}
                type="button"
                onClick={() => setSelectedId(s.sessionId)}
                className={`w-full border-b border-[#f0ece4] px-4 py-3 text-left transition-colors hover:bg-[#f7f4ee] ${
                  selectedId === s.sessionId ? "bg-[#f0ece4]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  {/* dot de status: verde = bot ativo, laranja = humano */}
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      s.botAtivo ? "bg-[#c8c3bb]" : "bg-amber-500"
                    }`}
                    title={s.botAtivo ? "Bot ativo" : "Atendimento humano"}
                  />
                  <span className="truncate text-xs font-semibold text-[#2c2825]">
                    {s.clientName ?? s.phone}
                  </span>
                </div>
                {s.clientName && (
                  <p className="mt-0.5 truncate text-[10px] text-[#8a8278]">{s.phone}</p>
                )}
                {s.lastPreview ? (
                  <p className="mt-0.5 line-clamp-1 text-xs text-[#8a8278]">
                    {s.lastPreview}
                  </p>
                ) : null}
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
                {(selectedSession.clientName ?? selectedSession.phone).slice(-2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#2c2825]">
                  {selectedSession.clientName ?? selectedSession.phone}
                </p>
                <p className="text-xs text-[#8a8278]">
                  {selectedSession.phone}
                  <span className={`ml-2 font-medium ${selectedSession.botAtivo ? "text-[#4D6D66]" : "text-amber-600"}`}>
                    · {selectedSession.botAtivo ? "Bot ativo" : "Atendimento humano"}
                  </span>
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
            <div className="space-y-2">
              {messages.map((row) => {
                const isAi = row.message.type === "ai";
                const text = parseContent(row.message);
                return (
                  <div
                    key={row.id}
                    className={`flex ${isAi ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        isAi
                          ? "rounded-br-sm bg-[#4D6D66] text-white"
                          : "rounded-bl-sm bg-white text-[#2c2825]"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{text}</p>
                    </div>
                  </div>
                );
              })}
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
