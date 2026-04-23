"use client";

import { useCallback, useEffect, useState } from "react";

export type PlanoRow = {
  id: string;
  codigo: string;
  nome: string;
  preco_mensal: number | null;
  preco_anual: number | null;
  descricao: string | null;
  features: string[];
  limite_profissionais: number;
  limite_agendamentos_mes: number;
  tem_crm: boolean;
  tem_agente_ia: boolean;
  tem_whatsapp: boolean;
  tem_relatorios: boolean;
  ativo: boolean;
  ordem: number;
};

const emptyForm: Omit<PlanoRow, "id"> = {
  codigo: "",
  nome: "",
  preco_mensal: null,
  preco_anual: null,
  descricao: "",
  features: [],
  limite_profissionais: -1,
  limite_agendamentos_mes: -1,
  tem_crm: false,
  tem_agente_ia: true,
  tem_whatsapp: true,
  tem_relatorios: true,
  ativo: true,
  ordem: 0,
};

const inputClass =
  "rounded-lg border border-neutral-600 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/40";
const labelClass = "text-xs font-medium text-neutral-300";

export function AdminPlanosManager() {
  const [planos, setPlanos] = useState<PlanoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<PlanoRow, "id"> & { id?: string }>({
    ...emptyForm,
  });
  const [featureDraft, setFeatureDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/planos", { credentials: "same-origin" });
      const j = (await res.json().catch(() => ({}))) as {
        planos?: PlanoRow[];
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `Erro ${res.status}`);
        setPlanos([]);
        return;
      }
      setPlanos((j.planos ?? []) as PlanoRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar.");
      setPlanos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startNew() {
    setEditingId(null);
    setForm({ ...emptyForm });
    setFeatureDraft("");
  }

  function startEdit(p: PlanoRow) {
    setEditingId(p.id);
    setForm({
      id: p.id,
      codigo: p.codigo,
      nome: p.nome,
      preco_mensal: p.preco_mensal,
      preco_anual: p.preco_anual,
      descricao: p.descricao ?? "",
      features: [...(p.features ?? [])],
      limite_profissionais: p.limite_profissionais,
      limite_agendamentos_mes: p.limite_agendamentos_mes,
      tem_crm: p.tem_crm,
      tem_agente_ia: p.tem_agente_ia,
      tem_whatsapp: p.tem_whatsapp,
      tem_relatorios: p.tem_relatorios,
      ativo: p.ativo,
      ordem: p.ordem,
    });
    setFeatureDraft("");
  }

  function addFeature() {
    const t = featureDraft.trim();
    if (!t) return;
    setForm((f) => ({ ...f, features: [...f.features, t] }));
    setFeatureDraft("");
  }

  function removeFeature(i: number) {
    setForm((f) => ({
      ...f,
      features: f.features.filter((_, idx) => idx !== i),
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body =
        editingId == null
          ? {
              codigo: form.codigo.trim().toLowerCase(),
              nome: form.nome.trim(),
              preco_mensal: form.preco_mensal,
              preco_anual: form.preco_anual,
              descricao: form.descricao || null,
              features: form.features,
              limite_profissionais: form.limite_profissionais,
              limite_agendamentos_mes: form.limite_agendamentos_mes,
              tem_crm: form.tem_crm,
              tem_agente_ia: form.tem_agente_ia,
              tem_whatsapp: form.tem_whatsapp,
              tem_relatorios: form.tem_relatorios,
              ativo: form.ativo,
              ordem: form.ordem,
            }
          : {
              id: editingId,
              codigo: form.codigo.trim().toLowerCase(),
              nome: form.nome.trim(),
              preco_mensal: form.preco_mensal,
              preco_anual: form.preco_anual,
              descricao: form.descricao || null,
              features: form.features,
              limite_profissionais: form.limite_profissionais,
              limite_agendamentos_mes: form.limite_agendamentos_mes,
              tem_crm: form.tem_crm,
              tem_agente_ia: form.tem_agente_ia,
              tem_whatsapp: form.tem_whatsapp,
              tem_relatorios: form.tem_relatorios,
              ativo: form.ativo,
              ordem: form.ordem,
            };

      const res = await fetch("/api/admin/planos", {
        method: editingId == null ? "POST" : "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `Erro ${res.status}`);
        return;
      }
      startNew();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAtivo(p: PlanoRow) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/planos", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, ativo: !p.ativo }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `Erro ${res.status}`);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-neutral-400">A carregar planos…</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-amber-500/25 bg-gradient-to-b from-neutral-900/90 to-neutral-950 p-6 shadow-sm">
        <h2 className="font-display text-xl font-semibold text-white">Planos e Preços</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Planos públicos (ativos) alimentam a landing e o select de assinatura das clínicas. Alterações
          refletem após recarregar essas páginas.
        </p>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-neutral-700 bg-neutral-900/80 p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">
            {editingId ? "Editar plano" : "Criar plano"}
          </h3>
          <button
            type="button"
            onClick={startNew}
            className="rounded-lg border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-amber-500/40 hover:text-amber-200"
          >
            Novo plano
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className={labelClass}>Código (único, n8n)</span>
            <input
              className={inputClass}
              value={form.codigo}
              onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
              disabled={editingId != null}
              placeholder="basico, mensal, enterprise…"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className={labelClass}>Nome exibido</span>
            <input
              className={inputClass}
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className={labelClass}>Preço mensal (vazio = sob consulta)</span>
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={form.preco_mensal ?? ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  preco_mensal: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className={labelClass}>Preço anual (opcional)</span>
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={form.preco_anual ?? ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  preco_anual: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            <span className={labelClass}>Descrição</span>
            <textarea
              className={`${inputClass} min-h-[72px]`}
              value={form.descricao ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className={labelClass}>Limite profissionais (-1 = ∞)</span>
            <input
              type="number"
              className={inputClass}
              value={form.limite_profissionais}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  limite_profissionais: Number(e.target.value),
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className={labelClass}>Limite agend. / mês (-1 = ∞)</span>
            <input
              type="number"
              className={inputClass}
              value={form.limite_agendamentos_mes}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  limite_agendamentos_mes: Number(e.target.value),
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className={labelClass}>Ordem</span>
            <input
              type="number"
              className={inputClass}
              value={form.ordem}
              onChange={(e) =>
                setForm((f) => ({ ...f, ordem: Number(e.target.value) }))
              }
            />
          </label>
          <div className="flex flex-wrap gap-4 text-xs sm:col-span-2">
            <label className="flex items-center gap-2 text-neutral-300">
              <input
                type="checkbox"
                className="accent-amber-500"
                checked={form.ativo}
                onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
              />
              Ativo
            </label>
            <label className="flex items-center gap-2 text-neutral-300">
              <input
                type="checkbox"
                className="accent-amber-500"
                checked={form.tem_crm}
                onChange={(e) => setForm((f) => ({ ...f, tem_crm: e.target.checked }))}
              />
              CRM
            </label>
            <label className="flex items-center gap-2 text-neutral-300">
              <input
                type="checkbox"
                className="accent-amber-500"
                checked={form.tem_agente_ia}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tem_agente_ia: e.target.checked }))
                }
              />
              Agente IA
            </label>
            <label className="flex items-center gap-2 text-neutral-300">
              <input
                type="checkbox"
                className="accent-amber-500"
                checked={form.tem_whatsapp}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tem_whatsapp: e.target.checked }))
                }
              />
              WhatsApp
            </label>
            <label className="flex items-center gap-2 text-neutral-300">
              <input
                type="checkbox"
                className="accent-amber-500"
                checked={form.tem_relatorios}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tem_relatorios: e.target.checked }))
                }
              />
              Relatórios
            </label>
          </div>
        </div>

        <div className="mt-4">
          <span className={`${labelClass} block`}>Funcionalidades (lista)</span>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className={`min-w-[200px] flex-1 ${inputClass}`}
              value={featureDraft}
              onChange={(e) => setFeatureDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addFeature();
                }
              }}
              placeholder="Nova linha de funcionalidade"
            />
            <button
              type="button"
              onClick={addFeature}
              className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400"
            >
              Adicionar
            </button>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-neutral-300">
            {form.features.map((line, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg bg-neutral-800/80 px-2 py-1"
              >
                <span>{line}</span>
                <button
                  type="button"
                  className="text-xs text-red-300 hover:underline"
                  onClick={() => removeFeature(i)}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={saving || !form.codigo.trim() || !form.nome.trim()}
            onClick={() => void save()}
            className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            {saving ? "A salvar…" : editingId ? "Atualizar plano" : "Criar plano"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-700 bg-neutral-900/80 p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-white">Todos os planos</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-600 text-xs text-neutral-500">
                <th className="pb-2 pr-2">Ordem</th>
                <th className="pb-2 pr-2">Código</th>
                <th className="pb-2 pr-2">Nome</th>
                <th className="pb-2 pr-2">Mensal</th>
                <th className="pb-2 pr-2">CRM</th>
                <th className="pb-2 pr-2">Ativo</th>
                <th className="pb-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {planos.map((p) => (
                <tr key={p.id} className="border-b border-neutral-800">
                  <td className="py-2 pr-2 text-neutral-300">{p.ordem}</td>
                  <td className="py-2 pr-2 font-mono text-xs text-neutral-400">{p.codigo}</td>
                  <td className="py-2 pr-2 text-neutral-200">{p.nome}</td>
                  <td className="py-2 pr-2 text-neutral-300">
                    {p.preco_mensal == null ? "—" : `R$ ${Number(p.preco_mensal).toFixed(2)}`}
                  </td>
                  <td className="py-2 pr-2 text-neutral-300">{p.tem_crm ? "sim" : "não"}</td>
                  <td className="py-2 pr-2 text-neutral-300">{p.ativo ? "sim" : "não"}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      className="mr-2 text-amber-400 underline-offset-2 hover:underline"
                      onClick={() => startEdit(p)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-neutral-300 underline-offset-2 hover:text-white hover:underline"
                      onClick={() => void toggleAtivo(p)}
                      disabled={saving}
                    >
                      {p.ativo ? "Desativar" : "Ativar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
