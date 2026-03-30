"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = {
  id: string;
  name: string;
  specialty: string | null;
  is_active: boolean;
  sort_order: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient;
  clinicId: string;
  onChanged: () => void;
  /** `panel` = conteúdo na área principal do painel (sem overlay). */
  presentation?: "modal" | "panel";
};

export function ProfessionalsManagerModal({
  open,
  onClose,
  supabase,
  clinicId,
  onChanged,
  presentation = "modal",
}: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("professionals")
      .select("id, name, specialty, is_active, sort_order")
      .eq("clinic_id", clinicId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    setLoading(false);
    if (e) {
      setError(e.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as Row[]);
  }, [supabase, clinicId]);

  useEffect(() => {
    if (!open) return;
    void load();
    setName("");
    setSpecialty("");
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
  const isPanel = presentation === "panel";

  async function addProfessional(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy("add");
    setError(null);
    const maxSort = rows.reduce((m, r) => Math.max(m, r.sort_order), -1);
    const { error: insE } = await supabase.from("professionals").insert({
      clinic_id: clinicId,
      name: n,
      specialty: specialty.trim() || null,
      is_active: true,
      sort_order: maxSort + 1,
    });
    setBusy(null);
    if (insE) {
      setError(insE.message);
      return;
    }
    setName("");
    setSpecialty("");
    await load();
    onChanged();
  }

  async function toggleActive(r: Row) {
    setBusy(r.id);
    setError(null);
    const { error: u } = await supabase
      .from("professionals")
      .update({ is_active: !r.is_active })
      .eq("id", r.id);
    setBusy(null);
    if (u) {
      setError(u.message);
      return;
    }
    await load();
    onChanged();
  }

  async function removeRow(r: Row) {
    if (
      !window.confirm(
        `Remover "${r.name}"? Só é possível se não existirem agendamentos ligados a este profissional.`
      )
    )
      return;
    setBusy(r.id);
    setError(null);
    const { error: d } = await supabase
      .from("professionals")
      .delete()
      .eq("id", r.id);
    setBusy(null);
    if (d) {
      setError(
        d.message.includes("foreign key") || d.code === "23503"
          ? "Não é possível apagar: há agendamentos. Use «Desativar» para ocultar nas novas marcações."
          : d.message
      );
      return;
    }
    await load();
    onChanged();
  }

  if (!open) return null;

  const formBlock = (
    <form
      onSubmit={(e) => void addProfessional(e)}
      className="space-y-4 rounded-[18px] border border-[#dfe8e5] bg-white/95 p-6 shadow-sm"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-[#6b8f89]">Novo cadastro</p>
      <p className="text-sm font-medium text-[#2c2825]">Adicionar profissional</p>
      <input
        required
        placeholder="Nome (ex.: Dra. Ana Silva)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-xl border border-[#d4cfc4] px-3 py-2.5 text-sm text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
      />
      <input
        placeholder="Área / especialidade (opcional)"
        value={specialty}
        onChange={(e) => setSpecialty(e.target.value)}
        className="w-full rounded-xl border border-[#d4cfc4] px-3 py-2.5 text-sm text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
      />
      <button
        type="submit"
        disabled={busy === "add"}
        className="w-full rounded-xl bg-[#0f766e] py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0d6560] disabled:opacity-50"
      >
        {busy === "add" ? "A guardar…" : "Adicionar profissional"}
      </button>
    </form>
  );

  const listBlock = (
    <div className="rounded-[18px] border border-[#dfe8e5] bg-[#fffdf9] p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#6b8f89]">Equipa</p>
      <p className="mt-1 text-sm text-[#6b635a]">Profissionais com agenda e horários próprios.</p>
      {loading ? (
        <p className="mt-4 text-sm text-[#6b635a]">A carregar…</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.length === 0 ? (
            <li className="text-sm text-[#8a8278]">
              Nenhum profissional ainda. Adicione pelo menos um para poder agendar.
            </li>
          ) : (
            rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ebe6dd] bg-white px-4 py-3 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[#2c2825]">{r.name}</p>
                  {r.specialty ? <p className="text-xs text-[#7a7268]">{r.specialty}</p> : null}
                  {!r.is_active ? (
                    <span className="mt-1 inline-block rounded bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-700">
                      Inativo
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void toggleActive(r)}
                    className="rounded-lg border border-[#ddd8cf] px-3 py-1.5 text-xs font-medium text-[#4a453d] hover:bg-[#f7f4ef] disabled:opacity-50"
                  >
                    {r.is_active ? "Desativar" : "Ativar"}
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void removeRow(r)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                  >
                    Apagar
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );

  if (isPanel) {
    return (
      <div
        className="w-full max-w-none text-left"
        role="region"
        aria-labelledby="pros-panel-title"
      >
        <header className="mb-6 border-b border-[#c5d9d4] pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0f766e]">Equipa clínica</p>
          <h1 id="pros-panel-title" className="font-display mt-2 text-2xl font-semibold tracking-tight text-[#0f2d28] sm:text-3xl">
            Profissionais
          </h1>
          <p className="mt-3 max-w-4xl text-sm leading-relaxed text-[#5c5348]">
            Cadastre médicos, esteticistas, odontologia, etc. Cada um pode ter horários em paralelo — o
            sistema evita apenas conflito no mesmo profissional.
          </p>
        </header>
        {error ? (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          {formBlock}
          {listBlock}
        </div>
        <div className="mt-8 flex justify-end border-t border-[#c5d9d4] pt-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#dcd5ca] bg-white px-5 py-2.5 text-sm font-medium text-[#5c5348] shadow-sm hover:bg-[#f7f4ef]"
          >
            Voltar ao dashboard
          </button>
        </div>
      </div>
    );
  }

  const shell = (
      <div
        className="relative z-10 flex max-h-[min(90vh,44rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#e6e1d8] bg-[#faf8f4] shadow-xl sm:max-h-[90vh]"
        aria-labelledby="pros-modal-title"
      >
        <div className="bg-[#4D6D66] px-5 py-4 text-white">
          <h2 id="pros-modal-title" className="font-display text-xl font-semibold">
            Profissionais da clínica
          </h2>
          <p className="mt-1 text-sm text-white/85">
            Cadastre médicos, esteticistas, odontologia, etc. Cada um pode ter horários ao mesmo tempo que
            outro — o sistema evita só choque no mesmo profissional.
          </p>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-5 py-4">
          <form
            onSubmit={(e) => void addProfessional(e)}
            className="mb-5 space-y-3 rounded-xl border border-[#e6e1d8] bg-white p-4"
          >
            <p className="text-sm font-medium text-[#2c2825]">Novo profissional</p>
            <input
              required
              placeholder="Nome (ex.: Dra. Ana Silva)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[#d4cfc4] px-3 py-2 text-sm text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
            />
            <input
              placeholder="Área / especialidade (opcional)"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              className="w-full rounded-lg border border-[#d4cfc4] px-3 py-2 text-sm text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
            />
            <button
              type="submit"
              disabled={busy === "add"}
              className="w-full rounded-lg bg-[#4D6D66] py-2 text-sm font-semibold text-white hover:bg-[#3f5c56] disabled:opacity-50"
            >
              {busy === "add" ? "A guardar…" : "Adicionar profissional"}
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
            <ul className="space-y-2">
              {rows.length === 0 ? (
                <li className="text-sm text-[#8a8278]">
                  Nenhum profissional ainda. Adicione pelo menos um para poder agendar.
                </li>
              ) : (
                rows.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e6e1d8] bg-white px-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[#2c2825]">{r.name}</p>
                      {r.specialty ? (
                        <p className="text-xs text-[#7a7268]">{r.specialty}</p>
                      ) : null}
                      {!r.is_active ? (
                        <span className="mt-1 inline-block rounded bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-700">
                          Inativo
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => void toggleActive(r)}
                        className="rounded-lg border border-[#ddd8cf] px-2 py-1.5 text-xs font-medium text-[#4a453d] hover:bg-[#f7f4ef] disabled:opacity-50"
                      >
                        {r.is_active ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => void removeRow(r)}
                        className="rounded-lg border border-red-200 px-2 py-1.5 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                      >
                        Apagar
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <div className="border-t border-[#e6e1d8] bg-white px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-[#ddd8cf] py-2 text-sm font-medium text-[#5c5348] hover:bg-[#f7f4ef]"
          >
            Fechar
          </button>
        </div>
      </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pros-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        aria-label="Fechar"
        onClick={onClose}
      />
      {shell}
    </div>
  );
}
