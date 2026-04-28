"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── tipos ────────────────────────────────────────────────────────────────────

type HistRow = {
  id: number;
  session_id: string;
  message: { type: "human" | "ai"; content: string };
  created_at: string | null;
};

type ClientRow = {
  telefone: string;
  nome: string;
  bot_ativo: boolean;
  /** Só existe se a coluna existir na base; realtime pode enviar. */
  nome_confirmado?: boolean | null;
};

type SessionInfo = {
  sessionId: string;
  phone: string;
  clientName: string | null;
  botAtivo: boolean;
  lastPreview: string;
  lastId: number;
  lastAt: string | null;
};

type Props = { supabase: SupabaseClient; clinicId: string };

// ─── helpers ──────────────────────────────────────────────────────────────────

function parsePhone(sessionId: string): string {
  const after = sessionId.split(":").slice(1).join(":");
  return after.split("@")[0] ?? after;
}

function normPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length >= 13 ? d.slice(2) : d;
}

/** Nome para exibir na lista: sem coluna `nome_confirmado`, qualquer nome preenchido conta. */
function displayClientName(
  nome: string | null | undefined,
  nomeConfirmado?: boolean | null
): string | null {
  const t = nome?.trim() ?? "";
  if (!t) return null;
  if (nomeConfirmado === false) return null;
  return t;
}

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

/** Formato WhatsApp: "agora", "5min", "14:30", "ontem", "25 jan" */
function formatTimeAgo(ts: string | null, now: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  if (diffDay === 0)
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDay === 1) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

/** Horário da mensagem: "14:30" */
function formatMsgTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Label de data para separadores: "Hoje", "Ontem", "25 de jan." */
function formatDateLabel(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  const diffDay = Math.floor(
    (today.setHours(0,0,0,0) - d.setHours(0,0,0,0)) / 86_400_000
  );
  if (diffDay === 0) return "Hoje";
  if (diffDay === 1) return "Ontem";
  return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
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
  const [limparNomeTambem, setLimparNomeTambem] = useState(true);
  const [limpandoAgente, setLimpandoAgente] = useState(false);
  const [agenteResetMsg, setAgenteResetMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  // ticker para atualizar timestamps ao vivo, como no WhatsApp
  const [now, setNow] = useState(() => Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const selectedSession = sessions.find((s) => s.sessionId === selectedId) ?? null;

  // ticker: atualiza "agora", "Xmin" etc. a cada 30 s
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── carrega sessões ──────────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);

    const [{ data: histRows }, { data: clients }] = await Promise.all([
      supabase
        .from("n8n_chat_histories")
        .select("id, session_id, message, created_at")
        .like("session_id", `${clinicId}:%`)
        .order("id", { ascending: false })
        .limit(2000),
      supabase
        .from("cs_clientes")
        .select("telefone, nome, bot_ativo")
        .eq("clinic_id", clinicId),
    ]);

    setLoadingSessions(false);
    if (!histRows?.length) {
      setSessions([]);
      return;
    }

    const clientList = (clients ?? []) as ClientRow[];

    const map = new Map<string, SessionInfo>();
    for (const row of histRows as HistRow[]) {
      if (map.has(row.session_id)) continue;
      const phone = parsePhone(row.session_id);
      const np = normPhone(phone);
      const client = clientList.find((c) => normPhone(c.telefone) === np);
      map.set(row.session_id, {
        sessionId: row.session_id,
        phone,
        clientName: displayClientName(client?.nome, client?.nome_confirmado),
        botAtivo: client?.bot_ativo ?? true,
        lastPreview: parseContent(row.message),
        lastId: row.id,
        lastAt: row.created_at ?? null,
      });
    }

    setSessions([...map.values()].sort((a, b) => b.lastId - a.lastId));
  }, [supabase, clinicId]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  // ── realtime: novas mensagens no chat_histories ──────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel(`wainbox-hist-${clinicId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "n8n_chat_histories" },
        (payload) => {
          const row = payload.new as HistRow;
          if (!row.session_id.startsWith(clinicId)) return;

          // Atualiza lista de sessões de forma incremental (sem reload total)
          setSessions((prev) => {
            const existing = prev.find((s) => s.sessionId === row.session_id);
            const preview = parseContent(row.message);
            if (existing) {
              // atualiza sessão existente e move para o topo
              const updated: SessionInfo = {
                ...existing,
                lastPreview: preview,
                lastId: row.id,
                lastAt: row.created_at ?? existing.lastAt,
              };
              return [updated, ...prev.filter((s) => s.sessionId !== row.session_id)];
            } else {
              // nova sessão — ainda sem nome do cliente, carrega depois
              const phone = parsePhone(row.session_id);
              const newSession: SessionInfo = {
                sessionId: row.session_id,
                phone,
                clientName: null,
                botAtivo: true,
                lastPreview: preview,
                lastId: row.id,
                lastAt: row.created_at ?? null,
              };
              return [newSession, ...prev];
            }
          });

          // Se esta sessão está aberta, adiciona a mensagem ao chat
          if (row.session_id === selectedIdRef.current) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev;
              return [...prev, row];
            });
          }
        }
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [supabase, clinicId]);

  // ── realtime: nome do cliente atualizado pelo agente ────────────────────
  useEffect(() => {
    const ch = supabase
      .channel(`wainbox-clientes-${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cs_clientes",
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          const row = payload.new as ClientRow | undefined;
          if (!row?.telefone) return;
          const np = normPhone(row.telefone);
          const name = displayClientName(row.nome, row.nome_confirmado);
          setSessions((prev) =>
            prev.map((s) =>
              normPhone(s.phone) === np
                ? {
                    ...s,
                    clientName: name,
                    botAtivo: row.bot_ativo ?? s.botAtivo,
                  }
                : s
            )
          );
        }
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [supabase, clinicId]);

  // ── carrega mensagens ao selecionar sessão ───────────────────────────────
  const loadMessages = useCallback(
    async (sessionId: string) => {
      setLoadingMessages(true);
      const { data } = await supabase
        .from("n8n_chat_histories")
        .select("id, session_id, message, created_at")
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

  // scroll ao fundo quando chegam novas mensagens
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

  async function limparMemoriaAgente() {
    if (!selectedId) return;
    const extra = limparNomeTambem
      ? " O nome guardado no cadastro também será apagado (teste como cliente novo)."
      : " O nome no cadastro será mantido.";
    if (
      !window.confirm(
        "Apagar todo o histórico de mensagens do agente (memória LangChain) para esta conversa?" +
          extra
      )
    ) {
      return;
    }
    setAgenteResetMsg(null);
    setLimpandoAgente(true);
    const { data, error } = await supabase.rpc("painel_limpar_sessao_agente", {
      p_clinic_id: clinicId,
      p_session_id: selectedId,
      p_limpar_nome: limparNomeTambem,
    });
    setLimpandoAgente(false);
    if (error) {
      setAgenteResetMsg({
        type: "err",
        text: error.message || "Não foi possível limpar a memória do agente.",
      });
      return;
    }
    const row = data as {
      historico_removido?: number;
      cadastro_nome_limpo?: number;
    } | null;
    const h = row?.historico_removido ?? 0;
    const n = row?.cadastro_nome_limpo ?? 0;
    setAgenteResetMsg({
      type: "ok",
      text:
        `Memória limpa (${h} mensagem(ns)).` +
        (limparNomeTambem
          ? n > 0
            ? ` Nome no cadastro zerado.`
            : ` Nenhuma linha de nome atualizada (telefone pode não bater com cs_clientes).`
          : ""),
    });
    setMessages([]);
    setSelectedId(null);
    await loadSessions();
  }

  // ── separadores de data nas mensagens ────────────────────────────────────
  function renderMessages() {
    const items: React.ReactNode[] = [];
    let lastDateLabel = "";

    for (const row of messages) {
      const isAi = row.message.type === "ai";
      const text = parseContent(row.message);
      const time = formatMsgTime(row.created_at);

      // separador de data
      if (row.created_at) {
        const label = formatDateLabel(row.created_at);
        if (label !== lastDateLabel) {
          lastDateLabel = label;
          items.push(
            <div key={`sep-${row.id}`} className="flex items-center gap-2 py-2">
              <div className="flex-1 border-t border-[#e6e1d8]" />
              <span className="shrink-0 rounded-full bg-[#e6e1d8] px-2.5 py-0.5 text-[10px] font-medium text-[#8a8278]">
                {label}
              </span>
              <div className="flex-1 border-t border-[#e6e1d8]" />
            </div>
          );
        }
      }

      items.push(
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
            {time && (
              <p
                className={`mt-1 text-right text-[10px] ${
                  isAi ? "text-white/60" : "text-[#b0a99e]"
                }`}
              >
                {time}
              </p>
            )}
          </div>
        </div>
      );
    }

    return items;
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
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      s.botAtivo ? "bg-[#c8c3bb]" : "bg-amber-500"
                    }`}
                    title={s.botAtivo ? "Bot ativo" : "Atendimento humano"}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[#2c2825]">
                    {s.clientName ?? s.phone}
                  </span>
                  {s.lastAt && (
                    <span className="shrink-0 text-[10px] text-[#b0a99e]">
                      {formatTimeAgo(s.lastAt, now)}
                    </span>
                  )}
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
        <div className="flex flex-col gap-2 border-b border-[#e6e1d8] bg-white px-5 py-3">
          <div className="flex items-center gap-3">
            {selectedSession ? (
              <>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4D6D66] text-xs font-bold text-white">
                  {(selectedSession.clientName ?? selectedSession.phone).slice(-2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#2c2825]">
                    {selectedSession.clientName ?? selectedSession.phone}
                  </p>
                  <p className="text-xs text-[#8a8278]">
                    {selectedSession.phone}
                    <span
                      className={`ml-2 font-medium ${
                        selectedSession.botAtivo ? "text-[#4D6D66]" : "text-amber-600"
                      }`}
                    >
                      · {selectedSession.botAtivo ? "Bot ativo" : "Atendimento humano"}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-[#8a8278] sm:text-xs">
                    <input
                      type="checkbox"
                      checked={limparNomeTambem}
                      onChange={(e) => setLimparNomeTambem(e.target.checked)}
                      className="rounded border-[#c8c3bb] text-[#4D6D66] focus:ring-[#4D6D66]"
                    />
                    Zerar nome (cliente novo)
                  </label>
                  <button
                    type="button"
                    disabled={limpandoAgente}
                    onClick={() => void limparMemoriaAgente()}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 sm:text-xs"
                    title="Apaga o histórico do agente para testes. Opcionalmente remove o nome do cadastro."
                  >
                    {limpandoAgente ? "A limpar…" : "Limpar memória do agente"}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-[#8a8278]">Selecione uma conversa</p>
            )}
          </div>
          {agenteResetMsg ? (
            <p
              className={`text-xs ${
                agenteResetMsg.type === "ok" ? "text-[#4D6D66]" : "text-red-600"
              }`}
            >
              {agenteResetMsg.text}
              {agenteResetMsg.type === "ok" ? " Envie uma mensagem pelo WhatsApp para voltar a ver a conversa aqui." : ""}
            </p>
          ) : null}
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
            <div className="space-y-1">
              {renderMessages()}
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
