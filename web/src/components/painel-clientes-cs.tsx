"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type CsClienteRow = {
  id: string;
  nome: string;
  telefone: string;
  bot_ativo: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  nome_confirmado: boolean | null;
};

type Tab = "conversas" | "todos";
type Props = { supabase: SupabaseClient; clinicId: string };

function normPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length >= 13 ? d.slice(2) : d;
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "agora mesmo";
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `há ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `há ${diffD}d`;
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(d);
  } catch {
    return "—";
  }
}

function formatCreated(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function friendlyDbMessage(err: { message?: string; code?: string } | null): string {
  if (!err?.message) return "Erro desconhecido.";
  if (err.code === "23505") return "Já existe um cliente com este telefone nesta clínica.";
  return err.message;
}

export function PainelClientesCs({ supabase, clinicId }: Props) {
  const [tab, setTab] = useState<Tab>("conversas");
  const [rows, setRows] = useState<CsClienteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [telefoneInput, setTelefoneInput] = useState("");
  const [nomeInput, setNomeInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CsClienteRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNomeDraft, setEditNomeDraft] = useState("");
  const [savingNomeId, setSavingNomeId] = useState<string | null>(null);
  const [nomeEditError, setNomeEditError] = useState<string | null>(null);
  const [togglingBotId, setTogglingBotId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setListError(null);
    setLoading(true);
    const { data, error } = await supabase
      .from("cs_clientes")
      .select("id, nome, telefone, bot_ativo, created_at, updated_at, nome_confirmado")
      .eq("clinic_id", clinicId)
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (error) { setListError(error.message); setRows([]); return; }
    setRows((data ?? []) as CsClienteRow[]);
  }, [supabase, clinicId]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  useEffect(() => {
    const ch = supabase
      .channel(`painel-cs-clientes-${clinicId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cs_clientes", filter: `clinic_id=eq.${clinicId}` }, () => { void loadRows(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [supabase, clinicId, loadRows]);

  const handleToggleBot = async (r: CsClienteRow) => {
    setTogglingBotId(r.id);
    const next = r.bot_ativo === false ? true : false;
    await supabase.from("cs_clientes").update({ bot_ativo: next }).eq("id", r.id).eq("clinic_id", clinicId);
    setTogglingBotId(null);
    void loadRows();
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    const digits = telefoneInput.replace(/\D/g, "");
    if (digits.length < 10) { setAddError("Informe um telefone válido (DDD + número)."); return; }
    setAdding(true);
    const { error } = await supabase.from("cs_clientes").insert({
      clinic_id: clinicId,
      telefone: normPhone(telefoneInput),
      nome: nomeInput.trim(),
    });
    setAdding(false);
    if (error) { setAddError(friendlyDbMessage(error)); return; }
    setTelefoneInput(""); setNomeInput("");
    void loadRows();
  };

  const startEditNome = (r: CsClienteRow) => { setNomeEditError(null); setEditingId(r.id); setEditNomeDraft(r.nome ?? ""); };
  const cancelEditNome = () => { setEditingId(null); setEditNomeDraft(""); setNomeEditError(null); };
  const saveNome = async (row: CsClienteRow) => {
    setNomeEditError(null);
    setSavingNomeId(row.id);
    const { error } = await supabase.from("cs_clientes").update({ nome: editNomeDraft.trim() }).eq("id", row.id).eq("clinic_id", clinicId);
    setSavingNomeId(null);
    if (error) { setNomeEditError(error.message); return; }
    cancelEditNome(); void loadRows();
  };

  const runDelete = async (row: CsClienteRow) => {
    setDeleteError(null); setDeletingId(row.id);
    const { error: delAppt } = await supabase.from("cs_agendamentos").delete().eq("clinic_id", clinicId).eq("cliente_id", row.id);
    if (delAppt) { setDeletingId(null); setDeleteError(delAppt.message); return; }
    const { error: delCliente } = await supabase.from("cs_clientes").delete().eq("clinic_id", clinicId).eq("id", row.id);
    setDeletingId(null); setDeleteConfirm(null);
    if (delCliente) { setDeleteError(delCliente.message); return; }
    void loadRows();
  };

  // "Conversas" = rows com updated_at (qualquer) — ordenados por recência
  const conversasRows = rows.filter((r) => r.updated_at != null);
  const displayRows = tab === "conversas" ? conversasRows : rows;

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-semibold transition-colors rounded-t-xl ${tab === t ? "bg-[var(--surface)] text-[var(--primary)] border-b-2 border-[var(--primary)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`;

  return (
    <div className="flex h-full min-h-0 w-full max-w-4xl flex-col gap-4">
      <div>
        <h1 className="font-display text-lg font-semibold text-[var(--text)]">Clientes</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Veja quem está conversando com o agente e gerencie o bot por cliente.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[var(--border)]">
        <button type="button" className={tabClass("conversas")} onClick={() => setTab("conversas")}>
          Conversas
          {conversasRows.length > 0 && (
            <span className="ml-2 rounded-full bg-[var(--primary)]/15 px-1.5 py-0.5 text-[10px] font-bold text-[var(--primary)]">
              {conversasRows.length}
            </span>
          )}
        </button>
        <button type="button" className={tabClass("todos")} onClick={() => setTab("todos")}>
          Todos os clientes
        </button>
      </div>

      {/* Conversas tab — cards por cliente */}
      {tab === "conversas" && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <span className="text-sm font-medium text-[var(--text)]">
              {loading ? "A carregar…" : `${conversasRows.length} conversa(s)`}
            </span>
            <button type="button" onClick={() => void loadRows()} className="text-xs font-medium text-[var(--primary)] hover:underline">
              Atualizar
            </button>
          </div>
          {listError && <p className="p-4 text-sm text-red-600 dark:text-red-400">{listError}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!loading && conversasRows.length === 0 && !listError ? (
              <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <p className="text-sm text-[var(--text-muted)]">Ainda não há conversas registadas.</p>
              </div>
            ) : null}
            <ul className="divide-y divide-[var(--border)]">
              {conversasRows.map((r) => {
                const nome = r.nome?.trim() || "";
                const nomeShow = nome || r.telefone;
                const botOn = r.bot_ativo !== false;
                const isToggling = togglingBotId === r.id;
                return (
                  <li key={r.id} className="flex items-center gap-4 px-4 py-3">
                    {/* Avatar */}
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${botOn ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-[var(--surface-soft)] text-[var(--text-muted)]"}`}>
                      {nome ? nome[0]!.toUpperCase() : "?"}
                    </div>
                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold text-[var(--text)]">{nomeShow}</p>
                        {r.nome_confirmado && nome ? (
                          <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                            Confirmado
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                        {nome ? r.telefone : ""}
                        <span className="ml-2 text-[var(--text-muted)]">· {formatTs(r.updated_at)}</span>
                      </p>
                    </div>
                    {/* Bot toggle */}
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`text-[10px] font-semibold uppercase ${botOn ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {botOn ? "Agente ativo" : "Pausado"}
                      </span>
                      <button
                        type="button"
                        disabled={isToggling}
                        onClick={() => void handleToggleBot(r)}
                        aria-label={botOn ? "Pausar agente para este cliente" : "Ativar agente para este cliente"}
                        className={`flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${botOn ? "bg-emerald-500" : "bg-[var(--border)]"}`}
                      >
                        <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${botOn ? "translate-x-[22px]" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Todos os clientes tab */}
      {tab === "todos" && (
        <>
          <form
            onSubmit={(e) => void handleAdd(e)}
            className="shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
          >
            <p className="mb-3 text-sm font-medium text-[var(--text)]">Acrescentar cliente</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block min-w-0 flex-1 text-xs text-[var(--text-muted)]">
                Telefone
                <input type="tel" value={telefoneInput} onChange={(e) => setTelefoneInput(e.target.value)} placeholder="11999998888" autoComplete="tel" className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]" />
              </label>
              <label className="block min-w-0 flex-1 text-xs text-[var(--text-muted)]">
                Nome (opcional)
                <input type="text" value={nomeInput} onChange={(e) => setNomeInput(e.target.value)} placeholder="Como aparece na agenda" className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]" />
              </label>
              <button type="submit" disabled={adding} className="shrink-0 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--primary-strong)] disabled:opacity-60">
                {adding ? "A gravar…" : "Adicionar"}
              </button>
            </div>
            {addError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{addError}</p>}
          </form>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <span className="text-sm font-medium text-[var(--text)]">
                {loading ? "A carregar…" : `${rows.length} cliente(s)`}
              </span>
              <button type="button" onClick={() => void loadRows()} className="text-xs font-medium text-[var(--primary)] hover:underline">Atualizar</button>
            </div>
            {listError && <p className="p-4 text-sm text-red-600 dark:text-red-400">{listError}</p>}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!loading && rows.length === 0 && !listError ? (
                <p className="p-6 text-center text-sm text-[var(--text-muted)]">Ainda não há clientes registados para esta clínica.</p>
              ) : null}
              <ul className="divide-y divide-[var(--border)]">
                {displayRows.map((r) => {
                  const nomeTrim = editingId === r.id ? editNomeDraft.trim() : (r.nome?.trim() ?? "");
                  const nomeShow = nomeTrim !== "" ? nomeTrim : "(sem nome)";
                  const botOn = r.bot_ativo !== false;
                  const isToggling = togglingBotId === r.id;
                  return (
                    <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        {editingId === r.id ? (
                          <label className="block">
                            <span className="sr-only">Nome</span>
                            <input
                              type="text"
                              value={editNomeDraft}
                              onChange={(e) => setEditNomeDraft(e.target.value)}
                              placeholder="Nome como na agenda"
                              disabled={savingNomeId === r.id}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Escape") { e.preventDefault(); cancelEditNome(); return; }
                                if (e.key === "Enter") { e.preventDefault(); void saveNome(r); }
                              }}
                              className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm font-medium text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2 disabled:opacity-60"
                            />
                          </label>
                        ) : (
                          <p className="truncate font-medium text-[var(--text)]">{nomeShow}</p>
                        )}
                        <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
                          {r.telefone}
                          {nomeTrim && (
                            <span className="ml-2 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                              Nome definido
                            </span>
                          )}
                        </p>
                        <div className="mt-1 flex items-center gap-3">
                          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
                            Criado {formatCreated(r.created_at)}
                          </span>
                          {r.updated_at && (
                            <span className="text-[11px] tabular-nums text-[var(--text-muted)]">· Ativo {formatTs(r.updated_at)}</span>
                          )}
                        </div>
                        {editingId === r.id && nomeEditError ? (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{nomeEditError}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end sm:pt-0.5">
                        {/* Bot toggle */}
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] font-semibold ${botOn ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                            {botOn ? "Bot ativo" : "Pausado"}
                          </span>
                          <button
                            type="button"
                            disabled={isToggling || editingId != null}
                            onClick={() => void handleToggleBot(r)}
                            aria-label={botOn ? "Pausar bot para este cliente" : "Ativar bot para este cliente"}
                            className={`flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${botOn ? "bg-emerald-500" : "bg-[var(--border)]"}`}
                          >
                            <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${botOn ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                          </button>
                        </div>
                        {editingId === r.id ? (
                          <>
                            <button type="button" onClick={() => void saveNome(r)} disabled={savingNomeId === r.id} className="rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/15 disabled:opacity-50">
                              {savingNomeId === r.id ? "A gravar…" : "Salvar"}
                            </button>
                            <button type="button" onClick={cancelEditNome} disabled={savingNomeId === r.id} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-soft)] disabled:opacity-50">
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => startEditNome(r)} disabled={deletingId === r.id || savingNomeId != null || editingId != null} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-soft)] disabled:opacity-50">
                              Editar
                            </button>
                            <button type="button" onClick={() => { setDeleteError(null); setDeleteConfirm(r); }} disabled={deletingId === r.id || editingId != null} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400">
                              Apagar
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {deleteError && <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>}
        </>
      )}

      {deleteConfirm ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="presentation">
          <button type="button" className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" aria-label="Fechar" onClick={() => setDeleteConfirm(null)} />
          <div role="alertdialog" aria-modal="true" className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl">
            <h2 className="font-display text-lg font-semibold text-[var(--text)]">Apagar cliente?</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text)]">{deleteConfirm.nome?.trim() || deleteConfirm.telefone}</span>
              {" — "}Todos os agendamentos deste cliente serão apagados. Esta ação não pode ser desfeita.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setDeleteConfirm(null)} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-soft)]">Cancelar</button>
              <button type="button" onClick={() => void runDelete(deleteConfirm)} disabled={deletingId != null} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                {deletingId ? "A apagar…" : "Apagar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
