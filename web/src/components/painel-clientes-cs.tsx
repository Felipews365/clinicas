"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type CsClienteRow = {
  id: string;
  nome: string;
  telefone: string;
  bot_ativo: boolean | null;
  created_at: string | null;
};

type Props = { supabase: SupabaseClient; clinicId: string };

function normPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length >= 13 ? d.slice(2) : d;
}

function formatClienteCreatedAt(iso: string | null): string {
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
  if (err.code === "23505")
    return "Já existe um cliente com este telefone nesta clínica.";
  return err.message;
}

export function PainelClientesCs({ supabase, clinicId }: Props) {
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

  const loadRows = useCallback(async () => {
    setListError(null);
    setLoading(true);
    const { data, error } = await supabase
      .from("cs_clientes")
      .select("id, nome, telefone, bot_ativo, created_at")
      .eq("clinic_id", clinicId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      setListError(error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as CsClienteRow[]);
  }, [supabase, clinicId]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    const ch = supabase
      .channel(`painel-cs-clientes-${clinicId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cs_clientes",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          void loadRows();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, clinicId, loadRows]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    const digits = telefoneInput.replace(/\D/g, "");
    if (digits.length < 10) {
      setAddError("Informe um telefone válido (DDD + número).");
      return;
    }
    const telefoneNorm = normPhone(telefoneInput);
    const nomeTrim = nomeInput.trim();
    setAdding(true);
    const { error } = await supabase.from("cs_clientes").insert({
      clinic_id: clinicId,
      telefone: telefoneNorm,
      nome: nomeTrim === "" ? "" : nomeTrim,
    });
    setAdding(false);
    if (error) {
      setAddError(friendlyDbMessage(error));
      return;
    }
    setTelefoneInput("");
    setNomeInput("");
    void loadRows();
  };

  const startEditNome = (r: CsClienteRow) => {
    setNomeEditError(null);
    setEditingId(r.id);
    setEditNomeDraft(r.nome ?? "");
  };

  const cancelEditNome = () => {
    setEditingId(null);
    setEditNomeDraft("");
    setNomeEditError(null);
  };

  const saveNome = async (row: CsClienteRow) => {
    setNomeEditError(null);
    const trimmed = editNomeDraft.trim();
    setSavingNomeId(row.id);
    const { error } = await supabase
      .from("cs_clientes")
      .update({ nome: trimmed })
      .eq("id", row.id)
      .eq("clinic_id", clinicId);
    setSavingNomeId(null);
    if (error) {
      setNomeEditError(error.message);
      return;
    }
    cancelEditNome();
    void loadRows();
  };

  const runDelete = async (row: CsClienteRow) => {
    setDeleteError(null);
    setDeletingId(row.id);
    const { error: delAppt } = await supabase
      .from("cs_agendamentos")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("cliente_id", row.id);
    if (delAppt) {
      setDeletingId(null);
      setDeleteError(delAppt.message);
      return;
    }
    const { error: delCliente } = await supabase
      .from("cs_clientes")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", row.id);
    setDeletingId(null);
    setDeleteConfirm(null);
    if (delCliente) {
      setDeleteError(delCliente.message);
      return;
    }
    void loadRows();
  };

  return (
    <div className="flex h-full min-h-0 w-full max-w-4xl flex-col gap-4">
      <div>
        <h1 className="font-display text-lg font-semibold text-[var(--text)]">
          Clientes
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Lista de clientes do agendamento (WhatsApp / CS). Pode acrescentar,
          alterar o nome, ou apagar — os agendamentos ligados a esse cliente são
          removidos primeiro ao apagar.
        </p>
      </div>

      <form
        onSubmit={(e) => void handleAdd(e)}
        className="shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
      >
        <p className="mb-3 text-sm font-medium text-[var(--text)]">
          Acrescentar cliente
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1 text-xs text-[var(--text-muted)]">
            Telefone
            <input
              type="tel"
              value={telefoneInput}
              onChange={(e) => setTelefoneInput(e.target.value)}
              placeholder="11999998888"
              autoComplete="tel"
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
            />
          </label>
          <label className="block min-w-0 flex-1 text-xs text-[var(--text-muted)]">
            Nome (opcional)
            <input
              type="text"
              value={nomeInput}
              onChange={(e) => setNomeInput(e.target.value)}
              placeholder="Como aparece na agenda"
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
            />
          </label>
          <button
            type="submit"
            disabled={adding}
            className="shrink-0 rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--primary-strong)] disabled:opacity-60"
          >
            {adding ? "A gravar…" : "Adicionar"}
          </button>
        </div>
        {addError ? (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{addError}</p>
        ) : null}
      </form>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <span className="text-sm font-medium text-[var(--text)]">
            {loading ? "A carregar…" : `${rows.length} cliente(s)`}
          </span>
          <button
            type="button"
            onClick={() => void loadRows()}
            className="text-xs font-medium text-[var(--primary)] hover:underline"
          >
            Atualizar
          </button>
        </div>
        {listError ? (
          <p className="p-4 text-sm text-red-600 dark:text-red-400">{listError}</p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!loading && rows.length === 0 && !listError ? (
            <p className="p-6 text-center text-sm text-[var(--text-muted)]">
              Ainda não há clientes registados para esta clínica.
            </p>
          ) : null}
          <ul className="divide-y divide-[var(--border)]">
            {rows.map((r) => {
              const nomeTrim =
                editingId === r.id
                  ? editNomeDraft.trim()
                  : (r.nome?.trim() ?? "");
              const nomeShow = nomeTrim !== "" ? nomeTrim : "(sem nome)";
              const confirmed = nomeTrim !== "";
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
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
                            if (e.key === "Escape") {
                              e.preventDefault();
                              cancelEditNome();
                              return;
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void saveNome(r);
                            }
                          }}
                          className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm font-medium text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2 disabled:opacity-60"
                        />
                      </label>
                    ) : (
                      <p className="truncate font-medium text-[var(--text)]">
                        {nomeShow}
                      </p>
                    )}
                    <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
                      {r.telefone}
                      {confirmed ? (
                        <span className="ml-2 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                          Nome definido
                        </span>
                      ) : null}
                      {r.bot_ativo === false ? (
                        <span className="ml-2 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-400">
                          Bot off
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[11px] tabular-nums text-[var(--text-muted)]">
                      Criado em {formatClienteCreatedAt(r.created_at)}
                    </p>
                    {editingId === r.id && nomeEditError ? (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {nomeEditError}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end sm:pt-0.5">
                    {editingId === r.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void saveNome(r)}
                          disabled={savingNomeId === r.id}
                          className="rounded-lg border border-[var(--primary)] bg-[var(--primary)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/15 disabled:opacity-50"
                        >
                          {savingNomeId === r.id ? "A gravar…" : "Salvar"}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditNome}
                          disabled={savingNomeId === r.id}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-soft)] disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditNome(r)}
                          disabled={
                            deletingId === r.id || savingNomeId != null || editingId != null
                          }
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-soft)] disabled:opacity-50"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteConfirm(r);
                          }}
                          disabled={deletingId === r.id || editingId != null}
                          className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                        >
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

      {deleteError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
      ) : null}

      {deleteConfirm ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
            aria-label="Fechar"
            onClick={() => setDeleteConfirm(null)}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
          >
            <h2 className="font-display text-lg font-semibold text-[var(--text)]">
              Apagar cliente?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text)]">
                {deleteConfirm.nome?.trim() || deleteConfirm.telefone}
              </span>
              {" — "}Todos os agendamentos deste cliente serão apagados. Esta
              ação não pode ser desfeita.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-soft)]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void runDelete(deleteConfirm)}
                disabled={deletingId != null}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deletingId ? "A apagar…" : "Apagar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
