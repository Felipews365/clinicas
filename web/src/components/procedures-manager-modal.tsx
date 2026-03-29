"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_brl: number | null;
  preco_a_vista_brl: number | null;
  tem_desconto: boolean;
  desconto_percentual: number | null;
  cartao_parcelas_max: number | null;
  is_active: boolean;
  sort_order: number;
};

type PayDraft = {
  price_brl: string;
  preco_a_vista_brl: string;
  tem_desconto: boolean;
  desconto_percentual: string;
  cartao_parcelas_max: string;
};

type RowEditDraft = PayDraft & {
  name: string;
  description: string;
  duration_minutes: string;
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const PARCELAS_OPTS = [
  "",
  ...Array.from({ length: 24 }, (_, i) => String(i + 1)),
];

function parsePriceBrlInput(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function parsePercentInput(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

function parseParcelasSelect(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  if (!Number.isFinite(n) || n < 1 || n > 24) return null;
  return n;
}

function rowToPayDraft(r: Row): PayDraft {
  return {
    price_brl: r.price_brl != null ? String(r.price_brl) : "",
    preco_a_vista_brl:
      r.preco_a_vista_brl != null ? String(r.preco_a_vista_brl) : "",
    tem_desconto: Boolean(r.tem_desconto),
    desconto_percentual:
      r.desconto_percentual != null ? String(r.desconto_percentual) : "",
    cartao_parcelas_max:
      r.cartao_parcelas_max != null ? String(r.cartao_parcelas_max) : "",
  };
}

function rowToRowDraft(r: Row): RowEditDraft {
  return {
    name: r.name,
    description: r.description ?? "",
    duration_minutes: String(r.duration_minutes),
    ...rowToPayDraft(r),
  };
}

function inputCls() {
  return "mt-0.5 w-full rounded-lg border border-[#d4cfc4] px-3 py-2 text-sm text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2";
}

function inputClsSm() {
  return "mt-0.5 w-full rounded-md border border-[#d4cfc4] px-2 py-1.5 text-xs text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-1";
}

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  clinicId: string;
  onChanged?: () => void;
};

export function ProceduresManagerModal({
  open,
  onClose,
  supabase,
  clinicId,
  onChanged,
}: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [priceBrl, setPriceBrl] = useState("");
  const [precoAvistaBrl, setPrecoAvistaBrl] = useState("");
  const [temDesconto, setTemDesconto] = useState(false);
  const [descontoPercent, setDescontoPercent] = useState("");
  const [cartaoParcelasMax, setCartaoParcelasMax] = useState("");
  const [rowDraftById, setRowDraftById] = useState<Record<string, RowEditDraft>>(
    {}
  );
  /** Procedimento com o painel de edição aberto (só nome na lista quando fechado). */
  const [expandedProcedureId, setExpandedProcedureId] = useState<string | null>(
    null
  );
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("clinic_procedures")
      .select(
        "id, name, description, duration_minutes, price_brl, preco_a_vista_brl, tem_desconto, desconto_percentual, cartao_parcelas_max, is_active, sort_order"
      )
      .eq("clinic_id", clinicId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    setLoading(false);
    if (e) {
      setError(e.message);
      setRows([]);
      return;
    }
    const list = (data ?? []) as Row[];
    setRows(list);
    setRowDraftById(
      Object.fromEntries(list.map((r) => [r.id, rowToRowDraft(r)]))
    );
  }, [supabase, clinicId]);

  useEffect(() => {
    if (!open) return;
    void load();
    setName("");
    setDescription("");
    setDurationMinutes("60");
    setPriceBrl("");
    setPrecoAvistaBrl("");
    setTemDesconto(false);
    setDescontoPercent("");
    setCartaoParcelasMax("");
    setExpandedProcedureId(null);
    setError(null);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  function validateRowDraft(d: RowEditDraft): string | null {
    if (!d.name.trim()) {
      return "O nome do procedimento é obrigatório.";
    }
    const dm = parseInt(d.duration_minutes, 10);
    if (!Number.isFinite(dm) || dm < 1 || dm > 480) {
      return "Duração deve ser entre 1 e 480 minutos.";
    }
    if (d.price_brl.trim() !== "" && parsePriceBrlInput(d.price_brl) === null) {
      return "Preço tabela inválido.";
    }
    if (
      d.preco_a_vista_brl.trim() !== "" &&
      parsePriceBrlInput(d.preco_a_vista_brl) === null
    ) {
      return "Preço à vista inválido.";
    }
    if (d.tem_desconto && d.desconto_percentual.trim() !== "") {
      if (parsePercentInput(d.desconto_percentual) === null) {
        return "Percentual de desconto inválido (use 0–100).";
      }
    }
    if (d.cartao_parcelas_max.trim() !== "") {
      if (parseParcelasSelect(d.cartao_parcelas_max) === null) {
        return "Parcelas no cartão: escolha entre 1 e 24.";
      }
    }
    return null;
  }

  function draftToPayload(d: PayDraft) {
    const price = parsePriceBrlInput(d.price_brl);
    const avista = parsePriceBrlInput(d.preco_a_vista_brl);
    const pct = d.tem_desconto
      ? parsePercentInput(d.desconto_percentual)
      : null;
    const parcelas = parseParcelasSelect(d.cartao_parcelas_max);
    return {
      price_brl: price,
      preco_a_vista_brl: avista,
      tem_desconto: d.tem_desconto,
      desconto_percentual: d.tem_desconto ? pct : null,
      cartao_parcelas_max: parcelas,
    };
  }

  async function addProcedure(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const draft: PayDraft = {
      price_brl: priceBrl,
      preco_a_vista_brl: precoAvistaBrl,
      tem_desconto: temDesconto,
      desconto_percentual: descontoPercent,
      cartao_parcelas_max: cartaoParcelasMax,
    };
    const verr = validateRowDraft({
      ...draft,
      name: n,
      description,
      duration_minutes: durationMinutes,
    });
    if (verr) {
      setError(verr);
      return;
    }
    const dm = parseInt(durationMinutes, 10);
    const pay = draftToPayload(draft);
    setBusy("add");
    setError(null);
    const maxSort = rows.reduce((m, r) => Math.max(m, r.sort_order), -1);
    const { error: insE } = await supabase.from("clinic_procedures").insert({
      clinic_id: clinicId,
      name: n,
      description: description.trim() || null,
      duration_minutes: dm,
      ...pay,
      is_active: true,
      sort_order: maxSort + 1,
    });
    setBusy(null);
    if (insE) {
      setError(
        insE.code === "23505"
          ? "Já existe um procedimento com este nome."
          : insE.message
      );
      return;
    }
    setName("");
    setDescription("");
    setDurationMinutes("60");
    setPriceBrl("");
    setPrecoAvistaBrl("");
    setTemDesconto(false);
    setDescontoPercent("");
    setCartaoParcelasMax("");
    await load();
    onChanged?.();
  }

  async function saveRowEdits(r: Row) {
    const d = rowDraftById[r.id] ?? rowToRowDraft(r);
    const verr = validateRowDraft(d);
    if (verr) {
      setError(verr);
      return;
    }
    const dm = parseInt(d.duration_minutes, 10);
    setBusy(r.id);
    setError(null);
    const { error: u } = await supabase
      .from("clinic_procedures")
      .update({
        name: d.name.trim(),
        description: d.description.trim() || null,
        duration_minutes: dm,
        ...draftToPayload(d),
      })
      .eq("id", r.id)
      .eq("clinic_id", clinicId);
    setBusy(null);
    if (u) {
      setError(
        u.code === "23505"
          ? "Já existe outro procedimento com este nome nesta clínica."
          : u.message
      );
      return;
    }
    await load();
    onChanged?.();
  }

  async function removeRow(r: Row) {
    if (
      !window.confirm(
        `Apagar permanentemente o procedimento «${r.name}»?\n\n` +
          "A linha será eliminada da base de dados (Supabase). Esta ação não pode ser desfeita."
      )
    )
      return;
    setBusy(r.id);
    setError(null);
    const { data: removed, error: d } = await supabase
      .from("clinic_procedures")
      .delete()
      .eq("id", r.id)
      .eq("clinic_id", clinicId)
      .select("id");
    setBusy(null);
    if (d) {
      setError(
        d.message.includes("permission") || d.code === "42501"
          ? `${d.message} — Confirme que é dono da clínica (RLS).`
          : d.message
      );
      return;
    }
    if (!removed?.length) {
      setError(
        "Nenhuma linha foi apagada. O procedimento pode já ter sido removido ou não pertence a esta clínica."
      );
      return;
    }
    setRowDraftById((prev) => {
      const next = { ...prev };
      delete next[r.id];
      return next;
    });
    setExpandedProcedureId((cur) => (cur === r.id ? null : cur));
    await load();
    onChanged?.();
  }

  function setRowDraft(id: string, patch: Partial<RowEditDraft>) {
    setRowDraftById((prev) => {
      const row = rows.find((x) => x.id === id);
      const empty: RowEditDraft = {
        name: "",
        description: "",
        duration_minutes: "60",
        price_brl: "",
        preco_a_vista_brl: "",
        tem_desconto: false,
        desconto_percentual: "",
        cartao_parcelas_max: "",
      };
      const base = prev[id] ?? (row ? rowToRowDraft(row) : empty);
      return { ...prev, [id]: { ...base, ...patch } };
    });
  }

  function paymentSummary(r: Row): string {
    const bits: string[] = [];
    if (r.price_brl != null) bits.push(brl.format(Number(r.price_brl)));
    if (r.preco_a_vista_brl != null) {
      bits.push(`à vista ${brl.format(Number(r.preco_a_vista_brl))}`);
    }
    if (r.tem_desconto) {
      bits.push(
        r.desconto_percentual != null
          ? `desconto ${Number(r.desconto_percentual)}%`
          : "com desconto"
      );
    }
    if (r.cartao_parcelas_max != null) {
      bits.push(`cartão até ${r.cartao_parcelas_max}x`);
    }
    return bits.length ? bits.join(" · ") : "sem valores definidos";
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="procedures-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        aria-label="Fechar"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#e6e1d8] bg-[#faf8f4] shadow-xl">
        <div className="bg-[#4D6D66] px-5 py-4 text-white">
          <h2 id="procedures-modal-title" className="font-display text-xl font-semibold">
            Procedimentos da clínica
          </h2>
          <p className="mt-1 text-sm text-white/85">
            Crie ou edite nome, descrição, duração e pagamento. O agente IA obtém os dados atualizados
            via{" "}
            <code className="rounded bg-white/15 px-1 text-xs">n8n_clinic_procedimentos</code>.
          </p>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-5 py-4">
          <form
            onSubmit={(e) => void addProcedure(e)}
            className="mb-5 space-y-3 rounded-xl border border-[#e6e1d8] bg-white p-4"
          >
            <p className="text-sm font-medium text-[#2c2825]">Novo procedimento</p>
            <input
              required
              placeholder="Nome (ex.: Consulta de rotina)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls()}
            />
            <textarea
              placeholder="Descrição curta (opcional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={inputCls()}
            />
            <label className="block text-xs font-medium text-[#5c5348]">
              Duração estimada (minutos)
              <input
                type="number"
                min={1}
                max={480}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className={inputCls()}
              />
            </label>

            <div className="rounded-lg border border-[#e8e4dc] bg-[#faf8f5] p-3">
              <p className="mb-2 text-xs font-semibold text-[#4a453d]">
                Pagamento e condições
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[11px] font-medium text-[#5c5348]">
                  Preço tabela / referência (R$, opcional)
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="ex.: 200"
                    value={priceBrl}
                    onChange={(e) => setPriceBrl(e.target.value)}
                    className={inputClsSm()}
                  />
                </label>
                <label className="block text-[11px] font-medium text-[#5c5348]">
                  À vista (R$, opcional)
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="ex.: 180"
                    value={precoAvistaBrl}
                    onChange={(e) => setPrecoAvistaBrl(e.target.value)}
                    className={inputClsSm()}
                  />
                </label>
              </div>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-medium text-[#5c5348]">
                <input
                  type="checkbox"
                  checked={temDesconto}
                  onChange={(e) => setTemDesconto(e.target.checked)}
                  className="h-4 w-4 rounded border-[#c4bdb0] text-[#4D6D66]"
                />
                Há desconto sobre o preço
              </label>
              {temDesconto ? (
                <label className="mt-2 block text-[11px] font-medium text-[#5c5348]">
                  Desconto (%)
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="ex.: 10"
                    value={descontoPercent}
                    onChange={(e) => setDescontoPercent(e.target.value)}
                    className={inputClsSm()}
                  />
                </label>
              ) : null}
              <label className="mt-3 block text-[11px] font-medium text-[#5c5348]">
                Cartão — parcelar em até
                <select
                  value={cartaoParcelasMax}
                  onChange={(e) => setCartaoParcelasMax(e.target.value)}
                  className={inputClsSm()}
                >
                  <option value="">Não definido / à combinar</option>
                  {PARCELAS_OPTS.slice(1).map((x) => (
                    <option key={x} value={x}>
                      {x}x
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              type="submit"
              disabled={busy === "add"}
              className="w-full rounded-lg bg-[#4D6D66] py-2 text-sm font-semibold text-white hover:bg-[#3f5c56] disabled:opacity-50"
            >
              {busy === "add" ? "A guardar…" : "Adicionar procedimento"}
            </button>
          </form>

          {error ? (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="text-sm text-[#6b635a]">A carregar…</p>
          ) : (
            <div>
              <p className="mb-2 text-xs font-semibold text-[#5c5348]">
                Procedimentos cadastrados
              </p>
              <p className="mb-2 text-[11px] text-[#8a8278]">
                Toque no nome para abrir ou fechar a edição.
              </p>
              <ul className="space-y-1.5" role="list">
                {rows.length === 0 ? (
                  <li className="text-sm text-[#8a8278]">
                    Nenhum procedimento ainda. Adicione os que o agente deve oferecer ao paciente.
                  </li>
                ) : (
                  rows.map((r) => {
                    const d = rowDraftById[r.id] ?? rowToRowDraft(r);
                    const isOpen = expandedProcedureId === r.id;
                    const listLabel = (d.name || r.name).trim() || "Sem nome";
                    return (
                      <li
                        key={r.id}
                        className="list-none overflow-hidden rounded-xl border border-[#e6e1d8] bg-white"
                      >
                        <button
                          type="button"
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#faf8f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#4D6D66] ${
                            isOpen ? "bg-[#f5f3ef]" : ""
                          }`}
                          aria-expanded={isOpen}
                          onClick={() =>
                            setExpandedProcedureId(isOpen ? null : r.id)
                          }
                        >
                          <span className="min-w-0 flex-1 font-medium text-[#2c2825]">
                            {listLabel}
                          </span>
                          {!r.is_active ? (
                            <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-zinc-700">
                              Inativo
                            </span>
                          ) : null}
                          <span
                            className="shrink-0 text-xs text-[#8a8278]"
                            aria-hidden
                          >
                            {isOpen ? "▲" : "▼"}
                          </span>
                        </button>

                        {isOpen ? (
                          <div className="space-y-3 border-t border-[#ebe6dd] bg-[#faf8f5]/90 px-3 py-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8a8278]">
                              Editar procedimento
                            </p>
                            <div className="space-y-2">
                              <label className="block text-[11px] font-medium text-[#5c5348]">
                                Nome
                                <input
                                  type="text"
                                  value={d.name}
                                  onChange={(e) =>
                                    setRowDraft(r.id, { name: e.target.value })
                                  }
                                  className={inputClsSm()}
                                />
                              </label>
                              <label className="block text-[11px] font-medium text-[#5c5348]">
                                Descrição (opcional)
                                <textarea
                                  value={d.description}
                                  onChange={(e) =>
                                    setRowDraft(r.id, {
                                      description: e.target.value,
                                    })
                                  }
                                  rows={2}
                                  className={`${inputClsSm()} resize-none`}
                                />
                              </label>
                              <label className="block text-[11px] font-medium text-[#5c5348]">
                                Duração (minutos)
                                <input
                                  type="number"
                                  min={1}
                                  max={480}
                                  value={d.duration_minutes}
                                  onChange={(e) =>
                                    setRowDraft(r.id, {
                                      duration_minutes: e.target.value,
                                    })
                                  }
                                  className={inputClsSm()}
                                />
                              </label>
                            </div>

                            <div className="space-y-2 border-t border-dashed border-[#e3ded6] pt-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8a8278]">
                                Pagamento e condições
                              </p>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <label className="text-[10px] font-medium text-[#8a8278]">
                                  Tabela (R$, opcional)
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={d.price_brl}
                                    onChange={(e) =>
                                      setRowDraft(r.id, {
                                        price_brl: e.target.value,
                                      })
                                    }
                                    className={inputClsSm()}
                                  />
                                </label>
                                <label className="text-[10px] font-medium text-[#8a8278]">
                                  À vista (R$, opcional)
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={d.preco_a_vista_brl}
                                    onChange={(e) =>
                                      setRowDraft(r.id, {
                                        preco_a_vista_brl: e.target.value,
                                      })
                                    }
                                    className={inputClsSm()}
                                  />
                                </label>
                              </div>
                              <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-[#5c5348]">
                                <input
                                  type="checkbox"
                                  checked={d.tem_desconto}
                                  onChange={(e) =>
                                    setRowDraft(r.id, {
                                      tem_desconto: e.target.checked,
                                    })
                                  }
                                  className="h-3.5 w-3.5 rounded border-[#c4bdb0]"
                                />
                                Desconto
                              </label>
                              {d.tem_desconto ? (
                                <label className="block text-[10px] font-medium text-[#8a8278]">
                                  % desconto
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={d.desconto_percentual}
                                    onChange={(e) =>
                                      setRowDraft(r.id, {
                                        desconto_percentual: e.target.value,
                                      })
                                    }
                                    className={inputClsSm()}
                                  />
                                </label>
                              ) : null}
                              <label className="block text-[10px] font-medium text-[#8a8278]">
                                Cartão até
                                <select
                                  value={d.cartao_parcelas_max}
                                  onChange={(e) =>
                                    setRowDraft(r.id, {
                                      cartao_parcelas_max: e.target.value,
                                    })
                                  }
                                  className={inputClsSm()}
                                >
                                  <option value="">—</option>
                                  {PARCELAS_OPTS.slice(1).map((x) => (
                                    <option key={x} value={x}>
                                      {x}x
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>

                            <div className="flex flex-wrap gap-2 border-t border-[#efeae3] pt-3">
                              <button
                                type="button"
                                disabled={busy === r.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void saveRowEdits(r);
                                }}
                                className="rounded-md bg-[#4D6D66] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3f5c56] disabled:opacity-50"
                              >
                                {busy === r.id
                                  ? "A guardar…"
                                  : "Guardar alterações"}
                              </button>
                              <button
                                type="button"
                                disabled={busy === r.id}
                                onClick={() => void removeRow(r)}
                                className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
                              >
                                Apagar da base de dados
                              </button>
                            </div>
                            <p className="text-[10px] text-[#9a9288]">
                              Último guardado: ~{r.duration_minutes} min ·{" "}
                              {paymentSummary(r)}
                            </p>
                          </div>
                        ) : null}
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="border-t border-[#e6e1d8] bg-white px-5 py-3">
          <p className="mb-2 text-[11px] leading-relaxed text-[#8a8278]">
            No n8n, chame{" "}
            <code className="rounded bg-[#f0ebe3] px-1 text-[10px]">
              n8n_clinic_procedimentos
            </code>{" "}
            com{" "}
            <code className="rounded bg-[#f0ebe3] px-1 text-[10px]">p_clinic_id</code> ={" "}
            <span className="font-mono text-[10px] text-[#5c5348]">{clinicId}</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-[#ddd8cf] py-2 text-sm font-medium text-[#5c5348] hover:bg-[#f7f4ef]"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
