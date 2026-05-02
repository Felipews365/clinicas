"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeProfessionalWhatsappBr } from "@/lib/br-whatsapp";

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
  /** Estado de `cs_clientes.nome_confirmado`; null = sem nome no cadastro ou coluna omitida */
  nomeConfirmado: boolean | null;
  botAtivo: boolean;
  lastPreview: string;
  lastId: number;
  lastAt: string | null;
};

type Props = {
  supabase: SupabaseClient;
  clinicId: string;
  initialPhone?: string;
  onInitialPhoneConsumed?: () => void;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function parsePhone(sessionId: string): string {
  const after = sessionId.split(":").slice(1).join(":");
  return after.split("@")[0] ?? after;
}

/** JID Evolution: só a parte antes de @whatsapp.net */
function stripJidTel(raw: string): string {
  return raw.split("@")[0]?.trim() ?? raw.trim();
}

/**
 * Igual aos dígitos canónicos BR (5511…) usados no cadastro; evita erro do antigo
 * `slice(2)` só em 13 caracteres que quebrava igualdade sessão ⇄ cliente.
 */
function telefoneCanonKey(raw: string): string | null {
  const core = stripJidTel(raw);
  if (!core) return null;
  const r = normalizeProfessionalWhatsappBr(core);
  if (r.ok && r.digits) return r.digits;
  const fallback = core.replace(/\D/g, "");
  return fallback.length > 0 ? fallback : null;
}

function telefonesEquivalentes(a: string, b: string): boolean {
  const ka = telefoneCanonKey(a);
  const kb = telefoneCanonKey(b);
  if (ka && kb && ka === kb) return true;
  const da = stripJidTel(a).replace(/\D/g, "");
  const db = stripJidTel(b).replace(/\D/g, "");
  if (!da || !db) return false;
  if (da === db) return true;
  /** Mesmo cliente com formatações levemente diferentes (ex.: dígitos finais coincidentes) */
  const n = Math.min(11, da.length, db.length);
  const ta = da.slice(-n);
  const tb = db.slice(-n);
  return ta === tb && n >= 10;
}

/** Preferir sempre linha cs_clientes com nome e estado confirmado quando há duplicados. */
function scoreClientePreferencia(c: ClientRow): number {
  let s = 0;
  const nome = c.nome?.trim() ?? "";
  if (nome) s += 10_000;
  if (c.nome_confirmado === true) s += 5000;
  if (c.nome_confirmado === false) s += 100;
  return s;
}

function pickClienteParaSessão(
  clientList: ClientRow[],
  sessionPhone: string,
): ClientRow | undefined {
  const matches = clientList.filter((c) =>
    telefonesEquivalentes(sessionPhone, c.telefone),
  );
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];
  return matches.reduce((best, cur) =>
    scoreClientePreferencia(cur) > scoreClientePreferencia(best) ? cur : best,
  );
}

/** Mantém no ref uma linha por número, priorizando nome / confirmação. */
function mergeClienteNaLista(list: ClientRow[], row: ClientRow): ClientRow[] {
  const outros = list.filter(
    (c) => !telefonesEquivalentes(c.telefone, row.telefone),
  );
  const candidatos = list.filter((c) =>
    telefonesEquivalentes(c.telefone, row.telefone),
  );
  const best =
    pickClienteParaSessão([...candidatos, row], row.telefone) ?? row;
  return [...outros, best];
}

/**
 * No inbox usamos sempre o texto guardado em `cs_clientes.nome` quando existir —
 * o mesmo registo gerido na área Clientes aparece aqui como título quando salvo.
 * `nome_confirmado` só orienta badges (nome definitivo vs a confirmar pelo agente).
 */
function inboxNomeCadastro(nome: string | null | undefined): string | null {
  const t = nome?.trim() ?? "";
  return t !== "" ? t : null;
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

/** Badges quando existe `nome` guardado — idem lista Clientes quando confirmado pela RPC */
function CadastroNomeBadge({
  nomeConfirmado,
}: {
  nomeConfirmado: boolean | null;
}) {
  if (nomeConfirmado === true)
    return (
      <span
        className="inline-flex shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-emerald-800"
        title="Nome confirmado e guardado no cadastro (Clientes)."
      >
        Nome definido
      </span>
    );
  if (nomeConfirmado === false)
    return (
      <span
        className="inline-flex shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-amber-900"
        title="O agente falou nome — ainda a confirmar (como novo ou retorno)."
      >
        A confirmar
      </span>
    );
  return (
    <span
      className="inline-flex shrink-0 rounded bg-[#e6ebe4] px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none text-[#4a5960]"
      title="Nome vindo do cadastro (coluna nome_confirmado não disponível ou legado)."
    >
      Cadastro
    </span>
  );
}

/** Iniciais para avatar (estilo WhatsApp) */
function waInitials(clientName: string | null, phone: string): string {
  const n = clientName?.trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`
        .toUpperCase()
        .slice(0, 2);
    }
    return n.slice(0, 2).toUpperCase();
  }
  const d = phone.replace(/\D/g, "").slice(-2);
  return d || "••";
}

/** Paleta próxima ao WhatsApp Web (claro) */
const wa = {
  sidebar: "bg-[#fff] border-[#d1d7db]",
  sidebarHover: "hover:bg-[#f5f6f6]",
  sidebarActive: "bg-[#f0f2f5]",
  header: "bg-[#f0f2f5] border-[#d1d7db]",
  wallpaper: "bg-[#efeae2]",
  bubbleIn: "bg-white text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
  bubbleOut:
    "bg-[#d9fdd3] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
  meta: "text-[#667781]",
  divider: "bg-[#ffffffe6] text-[#54656f] shadow-sm backdrop-blur-sm",
  searchBg: "bg-[#f0f2f5]",
  composer: "bg-[#f0f2f5]",
} as const;

// ─── componente ───────────────────────────────────────────────────────────────

export function WhatsappInbox({ supabase, clinicId, initialPhone, onInitialPhoneConsumed }: Props) {
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
  const [ativandoBot, setAtivandoBot] = useState(false);
  const [botActivateMsg, setBotActivateMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  // ticker para atualizar timestamps ao vivo, como no WhatsApp
  const [now, setNow] = useState(() => Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  /** Lista cs_clientes do último load — permite ligar nome a sessões novas por realtime antes do próximo reload. */
  const clientesListaRef = useRef<ClientRow[]>([]);
  const headerMenuRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [isNarrow, setIsNarrow] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "chat">("list");
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const blob = `${s.phone} ${s.clientName ?? ""} ${s.lastPreview}`.toLowerCase();
      return blob.includes(q);
    });
  }, [sessions, searchQuery]);

  const selectedSession = sessions.find((s) => s.sessionId === selectedId) ?? null;

  const selectSession = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (isNarrow) setMobilePane("chat");
    },
    [isNarrow]
  );

  const mobileBackToList = useCallback(() => {
    setMobilePane("list");
  }, []);

  // ticker: atualiza "agora", "Xmin" etc. a cada 30 s
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!isNarrow) setMobilePane("list");
  }, [isNarrow]);

  useEffect(() => {
    if (!headerMenuOpen) return;
    const down = (e: MouseEvent) => {
      if (
        headerMenuRef.current &&
        !headerMenuRef.current.contains(e.target as Node)
      ) {
        setHeaderMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [headerMenuOpen]);

  useEffect(() => {
    if (!headerMenuOpen) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHeaderMenuOpen(false);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [headerMenuOpen]);

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
        .select("telefone, nome, bot_ativo, nome_confirmado")
        .eq("clinic_id", clinicId),
    ]);

    setLoadingSessions(false);
    if (!histRows?.length) {
      setSessions([]);
      return;
    }

    const clientList = (clients ?? []) as ClientRow[];
    clientesListaRef.current = clientList;

    const map = new Map<string, SessionInfo>();
    for (const row of histRows as HistRow[]) {
      if (map.has(row.session_id)) continue;
      const phone = parsePhone(row.session_id);
      const client = pickClienteParaSessão(clientList, phone);
      const nomeList = inboxNomeCadastro(client?.nome);
      map.set(row.session_id, {
        sessionId: row.session_id,
        phone,
        clientName: nomeList,
        nomeConfirmado:
          nomeList !== null ? (client?.nome_confirmado ?? null) : null,
        botAtivo: client?.bot_ativo ?? true,
        lastPreview: parseContent(row.message),
        lastId: row.id,
        lastAt: row.created_at ?? null,
      });
    }

    setSessions([...map.values()].sort((a, b) => b.lastId - a.lastId));
  }, [supabase, clinicId]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  // Auto-seleccionar conversa quando vem de "Assumir atendimento"
  useEffect(() => {
    if (!initialPhone || sessions.length === 0) return;
    const match = sessions.find((s) => parsePhone(s.sessionId) === initialPhone || s.phone === initialPhone);
    if (match) {
      selectSession(match.sessionId);
      onInitialPhoneConsumed?.();
    }
  }, [initialPhone, sessions, selectSession, onInitialPhoneConsumed]);

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
              const phone = parsePhone(row.session_id);
              const client = pickClienteParaSessão(clientesListaRef.current, phone);
              const nomeNovo = inboxNomeCadastro(client?.nome);
              const newSession: SessionInfo = {
                sessionId: row.session_id,
                phone,
                clientName: nomeNovo,
                nomeConfirmado:
                  nomeNovo !== null ? (client?.nome_confirmado ?? null) : null,
                botAtivo: client?.bot_ativo ?? true,
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
          clientesListaRef.current = mergeClienteNaLista(
            clientesListaRef.current,
            row,
          );
          const name = inboxNomeCadastro(row.nome);
          setSessions((prev) =>
            prev.map((s) =>
              telefonesEquivalentes(s.phone, row.telefone)
                ? {
                    ...s,
                    clientName: name,
                    nomeConfirmado:
                      name !== null ? (row.nome_confirmado ?? null) : null,
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
    if (isNarrow) setMobilePane("list");
    await loadSessions();
  }

  async function ativarAgente() {
    if (!selectedSession) return;
    setAtivandoBot(true);
    setBotActivateMsg(null);
    try {
      const res = await fetch("/api/whatsapp/reactivate-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selectedSession.phone }),
        credentials: "include",
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setBotActivateMsg({ type: "err", text: j.error ?? `Erro ${res.status}` });
      } else {
        setBotActivateMsg({ type: "ok", text: "Agente IA reactivado." });
        setSessions((prev) =>
          prev.map((s) =>
            s.sessionId === selectedId ? { ...s, botAtivo: true } : s
          )
        );
      }
    } catch (e) {
      setBotActivateMsg({ type: "err", text: e instanceof Error ? e.message : "Falha de rede" });
    }
    setAtivandoBot(false);
  }

  async function copyMessageText(row: HistRow) {
    const text = parseContent(row.message);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(row.id);
      window.setTimeout(() => {
        setCopiedId((id) => (id === row.id ? null : id));
      }, 2000);
    } catch {
      /* só Safari antigo pode falhar */
    }
  }

  // ── separadores de data nas mensagens ────────────────────────────────────
  function renderMessages() {
    const items: React.ReactNode[] = [];
    let lastDateLabel = "";

    for (const row of messages) {
      const isAi = row.message.type === "ai";
      const text = parseContent(row.message);
      const time = formatMsgTime(row.created_at);
      const bubbleMeta = copiedId === row.id ? "Copiado!" : time;

      if (row.created_at) {
        const label = formatDateLabel(row.created_at);
        if (label !== lastDateLabel) {
          lastDateLabel = label;
          items.push(
            <div
              key={`sep-${row.id}`}
              className="flex items-center justify-center py-4"
            >
              <span
                className={`rounded-lg px-3 py-1 text-[11px] font-medium capitalize shadow-sm ${wa.divider}`}
              >
                {label}
              </span>
            </div>
          );
        }
      }

      items.push(
        <div
          key={row.id}
          className={`flex px-1 ${isAi ? "justify-end" : "justify-start"}`}
        >
          <button
            type="button"
            onClick={() => void copyMessageText(row)}
            title="Clique para copiar texto"
            className={`flex max-w-[min(92%,480px)] flex-col rounded-lg px-3 py-1.5 text-left text-sm leading-snug transition-opacity hover:opacity-95 focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#00A884]/50 ${
              isAi ? `${wa.bubbleOut} rounded-tr-none` : `${wa.bubbleIn} rounded-tl-none`
            }`}
          >
            <span className="whitespace-pre-wrap break-words text-[15px]">{text}</span>
            {(time || copiedId === row.id) && (
              <span
                className={`mt-1 self-end text-[11px] leading-none tracking-tight tabular-nums ${wa.meta}`}
              >
                {bubbleMeta}
              </span>
            )}
          </button>
        </div>
      );
    }

    return items;
  }

  const listVisible = !isNarrow || mobilePane === "list";
  const chatVisible = !isNarrow || mobilePane === "chat";

  return (
    <div
      className={`flex h-full min-h-0 w-full overflow-hidden rounded-2xl border ${wa.sidebar} shadow-[0_1px_1px_rgba(11,20,26,0.06)]`}
    >
      {/* Lista de chats — estilo WhatsApp Web */}
      <div
        className={`${listVisible ? "flex" : "hidden"} w-full shrink-0 flex-col md:flex md:w-[360px] ${wa.sidebar}`}
      >
        {/* Barra topo (tipo WA) */}
        <header
          className={`flex items-center gap-2 border-b px-3 py-3 ${wa.header}`}
        >
          <div
            className={`relative flex flex-1 items-center rounded-lg py-1.5 pl-2 pr-2 ${wa.searchBg}`}
          >
            <svg
              className="pointer-events-none absolute left-4 h-[18px] w-[18px] text-[#54656f]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar conversa"
              aria-label="Pesquisar conversas"
              className="w-full rounded-lg bg-transparent py-1.5 pl-10 pr-3 text-[14px] text-[#111b21] outline-none placeholder:text-[#889196]"
            />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {loadingSessions ? (
            <p className={`px-4 py-10 text-center text-[13px] ${wa.meta}`}>
              A carregar conversas…
            </p>
          ) : sessions.length === 0 ? (
            <p className={`px-4 py-10 text-center text-[13px] ${wa.meta}`}>
              Nenhuma conversa — quando o cliente falar pelo WhatsApp, aparece aqui.
            </p>
          ) : filteredSessions.length === 0 ? (
            <p className={`px-4 py-10 text-center text-[13px] ${wa.meta}`}>
              Nenhum resultado para «{searchQuery}»
            </p>
          ) : (
            filteredSessions.map((s) => {
              const title = s.clientName ?? s.phone;
              const initials = waInitials(s.clientName, s.phone);
              const sel = selectedId === s.sessionId;
              return (
                <button
                  key={s.sessionId}
                  type="button"
                  onClick={() => selectSession(s.sessionId)}
                  className={`flex w-full items-start gap-3 border-b border-[#e9edef] px-3 py-[10px] text-left transition-colors ${wa.sidebarHover} ${
                    sel
                      ? `${wa.sidebarActive} border-l-[3px] border-l-[#25D366] pl-[10px]`
                      : "border-l-[4px] border-l-transparent"
                  }`}
                >
                  <div className="flex h-[49px] w-[49px] shrink-0 items-center justify-center rounded-full bg-[#dfe5e9] text-[17px] font-medium text-[#54656f]">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1 py-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[16px] leading-tight text-[#111b21]">
                        {title}
                      </span>
                      {s.lastAt ? (
                        <span
                          className={`shrink-0 text-[11px] tabular-nums ${
                            sel ? "font-medium text-[#25D366]" : "font-normal text-[#85939b]"
                          }`}
                        >
                          {formatTimeAgo(s.lastAt, now)}
                        </span>
                      ) : null}
                    </div>
                    {s.clientName ? (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <CadastroNomeBadge nomeConfirmado={s.nomeConfirmado} />
                        <span
                          className="min-w-0 truncate text-[12px] text-[#667781]"
                          title={s.phone}
                        >
                          {s.phone}
                        </span>
                      </div>
                    ) : null}
                    {!s.botAtivo && (
                      <span className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        <span className="h-[5px] w-[5px] rounded-full bg-amber-500" />
                        Humano
                      </span>
                    )}
                    <div className="mt-0.5 flex items-start gap-1.5 pr-6">
                      <p className={`line-clamp-2 break-words text-[14px] leading-snug ${wa.meta}`}>
                        {s.lastPreview || "\u00a0"}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Chat */}
      <div
        className={`${
          chatVisible ? "flex" : "hidden md:flex"
        } min-h-0 min-w-0 flex-1 flex-col bg-[#f0f2f5]`}
      >
        {/* Cabeçalho */}
        <div
          className={`flex flex-col gap-0 border-b ${wa.header} shadow-[0_1px_1px_rgba(11,20,26,0.08)]`}
        >
          <div className="flex min-h-[59px] items-center gap-1 px-2 py-1.5 sm:px-3">
            {isNarrow ? (
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] hover:bg-[#dfe5e9]"
                aria-label="Voltar às conversas"
                onClick={mobileBackToList}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}
            {selectedSession ? (
              <>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#dfe5e9] text-[15px] font-semibold text-[#54656f]">
                  {waInitials(selectedSession.clientName, selectedSession.phone)}
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  <div className="flex min-w-0 flex-wrap items-end gap-x-2 gap-y-1">
                    <p className="truncate text-[16px] font-medium leading-tight text-[#111b21]">
                      {selectedSession.clientName ?? selectedSession.phone}
                    </p>
                    {selectedSession.clientName ? (
                      <CadastroNomeBadge
                        nomeConfirmado={selectedSession.nomeConfirmado}
                      />
                    ) : null}
                  </div>
                  <p className="truncate text-[13px] text-[#667781]">
                    {selectedSession.phone}
                    <span className="mx-1">·</span>
                    <span
                      className={
                        selectedSession.botAtivo ? "text-[#00A884]" : "font-medium text-amber-600"
                      }
                    >
                      {selectedSession.botAtivo ? "Bot ativo" : "Humano"}
                    </span>
                  </p>
                </div>
                <div className="relative shrink-0" ref={headerMenuRef}>
                  <button
                    type="button"
                    aria-expanded={headerMenuOpen}
                    aria-label="Mais opções da conversa"
                    onClick={() => setHeaderMenuOpen((o) => !o)}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-[#54656f] hover:bg-[#dfe5e9]"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <circle cx="12" cy="6" r="1.6" />
                      <circle cx="12" cy="12" r="1.6" />
                      <circle cx="12" cy="18" r="1.6" />
                    </svg>
                  </button>
                  {headerMenuOpen ? (
                    <div className="absolute right-0 top-full z-[150] mt-1 w-[min(calc(100vw-2rem),300px)] overflow-hidden rounded-lg border border-[#d1d7db] bg-white py-1 shadow-[0_2px_12px_rgba(11,20,26,0.15)]">
                      {!selectedSession?.botAtivo && (
                        <button
                          type="button"
                          disabled={ativandoBot}
                          onClick={() => { setHeaderMenuOpen(false); void ativarAgente(); }}
                          className="w-full px-3 py-2.5 text-left text-[13px] font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 border-b border-[#e9edef]"
                        >
                          {ativandoBot ? "A activar agente…" : "✦ Ativar agente IA"}
                        </button>
                      )}
                      <label className="flex cursor-pointer items-start gap-2 border-b border-[#e9edef] px-3 py-2.5 text-[13px] text-[#111b21] hover:bg-[#f5f6f6]">
                        <input
                          type="checkbox"
                          checked={limparNomeTambem}
                          onChange={(e) => setLimparNomeTambem(e.target.checked)}
                          className="mt-0.5 rounded border-[#c8c3bb]"
                        />
                        <span>Zerar nome no cadastro ao limpar memória</span>
                      </label>
                      <button
                        type="button"
                        disabled={limpandoAgente}
                        onClick={() => {
                          setHeaderMenuOpen(false);
                          void limparMemoriaAgente();
                        }}
                        className="w-full px-3 py-2.5 text-left text-[13px] font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                      >
                        {limpandoAgente ? "A limpar memória…" : "Limpar memória do agente…"}
                      </button>
                      <p className="border-t border-[#e9edef] px-3 py-2 text-[11px] leading-snug text-[#667781]">
                        Para testes: apaga LangChain aqui e as mensagens já não aparecem até voltar a conversar pelo WhatsApp.
                      </p>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-4 py-2">
                <div className="text-center">
                  <p className="text-[15px] font-medium text-[#41525a]">
                    Conversas WhatsApp
                  </p>
                  <p className="mt-0.5 text-[13px] text-[#667781]">
                    Escolha um contato à esquerda
                  </p>
                </div>
              </div>
            )}
          </div>
          {botActivateMsg ? (
            <div
              className={`mx-3 mb-2 rounded-lg px-3 py-2 text-[12px] leading-relaxed ${
                botActivateMsg.type === "ok"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {botActivateMsg.text}
            </div>
          ) : null}
          {agenteResetMsg ? (
            <div
              className={`mx-3 mb-2 rounded-lg px-3 py-2 text-[12px] leading-relaxed ${
                agenteResetMsg.type === "ok"
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {agenteResetMsg.text}
              {agenteResetMsg.type === "ok"
                ? " Envie pelo WhatsApp para voltar a ver mensagens novas aqui."
                : ""}
            </div>
          ) : null}
        </div>

        {/* Histórico (papel de parede WhatsApp) */}
        <div
          className={`relative min-h-[200px] flex-1 overflow-y-auto ${wa.wallpaper}`}
          style={{
            backgroundImage: `radial-gradient(circle at 24px 30px, rgba(0,0,0,.04) 0.5px, transparent 1px), radial-gradient(circle at 3px 3px, rgba(11,30,43,.035) 0.65px, transparent 0.7px)`,
            backgroundSize: "48px 60px",
          }}
        >
          {!selectedId ? (
            <div className="flex min-h-[min(380px,calc(100vh-260px))] flex-col items-center justify-center px-6 text-center">
              <div className="mb-4 rounded-full bg-[#e6ebe4] px-10 py-6 shadow-inner">
                <svg width="260" height="130" viewBox="0 0 320 160" aria-hidden className="mx-auto text-[#b7c9ba] opacity-95">
                  <path
                    fill="currentColor"
                    d="M38 132c0-52 52-104 118-116 11-25 52-53 126-53v104c0 43-54 71-136 71-43 0-79-11-108-31v25z"
                    opacity=".35"
                  />
                  <ellipse cx="255" cy="46" rx="28" ry="34" fill="currentColor" opacity=".55" />
                </svg>
              </div>
              <p className="max-w-[400px] text-[22px] font-light tracking-tight text-[#41525a]">
                Inbox do WhatsApp
              </p>
              <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-[#8696a0]">
                Veja mensagens ao cliente à esquerda, responda daqui e acompanhe o agente de IA ao vivo.
              </p>
              {isNarrow ? (
                <button
                  type="button"
                  onClick={() => mobileBackToList()}
                  className="mt-8 rounded-full bg-[#00A884] px-6 py-2.5 text-[15px] font-medium text-white shadow-md hover:bg-[#008069]"
                >
                  Abrir lista de chats
                </button>
              ) : null}
            </div>
          ) : loadingMessages ? (
            <p className={`absolute inset-x-0 top-24 text-center text-[13px] ${wa.meta}`}>
              A sincronizar mensagens…
            </p>
          ) : messages.length === 0 ? (
            <p className={`absolute inset-x-0 top-24 text-center text-[13px] ${wa.meta}`}>
              Ainda não há histórico. Quando enviarem pelo WhatsApp, aparece aqui.
            </p>
          ) : (
            <div className="space-y-1 px-2 py-4 sm:px-6">
              {renderMessages()}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Compositor */}
        {selectedId && chatVisible ? (
          <div className={`shrink-0 border-t border-[#d1d7db] ${wa.composer} px-2 py-3 sm:px-4`}>
            {sendError ? (
              <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] text-red-800">
                {sendError}
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <div className="flex min-h-[52px] flex-1 items-end rounded-2xl border border-[#d1d7db] bg-white px-2 py-1.5 shadow-sm">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Mensagem"
                  rows={1}
                  className="max-h-[7.5rem] min-h-[40px] w-full flex-1 resize-none border-none bg-transparent px-2 py-2 text-[15px] leading-[1.34] text-[#111b21] outline-none placeholder:text-[#8696a0]"
                />
              </div>
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={sending || !input.trim()}
                className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-[#00A884] text-white shadow-[0_1px_4px_rgba(11,20,26,0.15)] hover:bg-[#008069] disabled:cursor-not-allowed disabled:opacity-35"
                title="Enviar"
              >
                {sending ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="animate-spin opacity-95">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity=".3" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M1.101 21.757 23.8 12.028 1.101 2.3l.022 7.912 13.623 1.816-13.623 1.727z" />
                  </svg>
                )}
              </button>
            </div>
            <p className="mt-1.5 text-center text-[11px] text-[#8696a0]">
              Enter envia · Shift+Enter nova linha · Texto da clínica enviado ao cliente no WhatsApp
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
