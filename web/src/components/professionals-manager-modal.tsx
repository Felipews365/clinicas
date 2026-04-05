"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProfessionalAvatar } from "@/components/professional-avatar";
import {
  DEFAULT_PROFESSIONAL_PANEL_COLOR,
  PROFESSIONAL_PALETTE,
  resolveProfessionalCardStyle,
} from "@/lib/professional-palette";
import {
  PROFESSIONAL_AVATAR_BUCKET,
  PROFESSIONAL_AVATAR_EMOJI_OPTIONS,
  guessImageExt,
  professionalAvatarPublicUrl,
  storagePathForProfessionalAvatar,
} from "@/lib/professional-avatar";
import {
  FULL_CLINIC_AGENDA_HOURS,
  formatAgendaHourLabel,
  normalizeAgendaVisibleHours,
} from "@/lib/clinic-agenda-hours";

type Row = {
  id: string;
  name: string;
  specialty: string | null;
  whatsapp: string | null;
  is_active: boolean;
  sort_order: number;
  panel_color: string | null;
  avatar_path: string | null;
  avatar_emoji: string | null;
  agenda_hours: number[] | null;
};

function rowPaletteValue(r: Row): string {
  return r.panel_color?.trim()
    ? r.panel_color.trim()
    : DEFAULT_PROFESSIONAL_PANEL_COLOR;
}

function ProfessionalPanelColorField({
  value,
  onChange,
  previewHint,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  previewHint?: string;
  disabled?: boolean;
}) {
  const preview = resolveProfessionalCardStyle(value, "preview-field");
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-[#5c5348]">
          Cor do profissional
        </p>
        <p className="mt-0.5 text-[11px] text-[#8a8278]">
          Paleta fixa — usada nos cards do painel, na agenda e nos filtros.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PROFESSIONAL_PALETTE.map((p) => {
            const sel =
              value.trim().toUpperCase() === p.value.trim().toUpperCase();
            return (
              <button
                key={p.value}
                type="button"
                title={p.label}
                disabled={disabled}
                onClick={() => onChange(p.value)}
                className={`h-9 w-9 rounded-lg border-2 shadow-sm transition-transform disabled:opacity-50 ${
                  sel
                    ? "scale-105 border-[#0f766e] ring-2 ring-[#0f766e]/35"
                    : "border-[#e6e1d8] hover:scale-105"
                }`}
                style={{ background: p.value }}
              />
            );
          })}
        </div>
      </div>
      <div
        className="rounded-2xl border px-3 py-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
        style={{
          background: preview.lightBg,
          borderColor: preview.lightBorder,
        }}
      >
        <p className="mb-2 leading-relaxed text-[#6b635a]">
          {previewHint ??
            "Assim os clientes e agendamentos deste profissional aparecem no painel."}
        </p>
        <span
          className="inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm"
          style={{
            background: preview.badgeBg,
            color: preview.badgeFg,
            borderColor: preview.lightBorder,
          }}
        >
          Pré-visualização
        </span>
      </div>
    </div>
  );
}

function EmojiFallbackPicker({
  value,
  onChange,
  disabled,
  label = "Emoji de reserva (sem foto)",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[#5c5348]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange("")}
          className={`flex h-9 w-9 items-center justify-center rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
            !value
              ? "border-[#0f766e] bg-[#e6f5f3] text-[#0f766e]"
              : "border-[#e6e1d8] bg-white text-[#8a8278] hover:bg-[#f7f4ef]"
          }`}
          title="Sem emoji"
        >
          —
        </button>
        {PROFESSIONAL_AVATAR_EMOJI_OPTIONS.map((em) => {
          const sel = value === em;
          return (
            <button
              key={em}
              type="button"
              disabled={disabled}
              title={em}
              onClick={() => onChange(em)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg leading-none transition-colors disabled:opacity-50 ${
                sel
                  ? "scale-105 border-[#0f766e] ring-2 ring-[#0f766e]/30"
                  : "border-[#e6e1d8] bg-white hover:bg-[#f7f4ef]"
              }`}
            >
              {em}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RowColorSwatches({ row, busy, onPick }: { row: Row; busy: boolean; onPick: (value: string) => void }) {
  const current = rowPaletteValue(row).toUpperCase();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[#9a9288]">
        Cor
      </span>
      {PROFESSIONAL_PALETTE.map((p) => {
        const sel = current === p.value.toUpperCase();
        return (
          <button
            key={p.value}
            type="button"
            title={p.label}
            disabled={busy}
            onClick={() => onPick(p.value)}
            className={`h-6 w-6 rounded-md border shadow-sm transition-transform disabled:opacity-50 ${
              sel
                ? "ring-2 ring-[#0f766e] ring-offset-1 ring-offset-white"
                : "border-[#e6e1d8] hover:scale-110"
            }`}
            style={{ background: p.value }}
          />
        );
      })}
    </div>
  );
}

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
  const [newWhatsapp, setNewWhatsapp] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_PROFESSIONAL_PANEL_COLOR);
  const [newEmoji, setNewEmoji] = useState("");
  const [newPhotoFile, setNewPhotoFile] = useState<File | null>(null);
  const [newPhotoPreview, setNewPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSpecialty, setEditSpecialty] = useState("");
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [editAgendaCustom, setEditAgendaCustom] = useState(false);
  const [editAgendaHours, setEditAgendaHours] = useState<Set<number>>(new Set());

  const revokePreview = useCallback((url: string | null) => {
    if (url) URL.revokeObjectURL(url);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("professionals")
      .select(
        "id, name, specialty, whatsapp, is_active, sort_order, panel_color, avatar_path, avatar_emoji, agenda_hours"
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
    setRows((data ?? []) as Row[]);
  }, [supabase, clinicId]);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setNewPhotoPreview((prev) => {
        revokePreview(prev);
        return null;
      });
      setNewPhotoFile(null);
      return;
    }
    void load();
    setEditingId(null);
    setName("");
    setSpecialty("");
    setNewWhatsapp("");
    setNewColor(DEFAULT_PROFESSIONAL_PANEL_COLOR);
    setNewEmoji("");
    setNewPhotoFile(null);
    setNewPhotoPreview((prev) => {
      revokePreview(prev);
      return null;
    });
    setError(null);
  }, [open, load, revokePreview]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editingId) {
        setEditingId(null);
        setEditName("");
        setEditSpecialty("");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose, editingId]);
  const isPanel = presentation === "panel";

  async function addProfessional(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy("add");
    setError(null);
    const maxSort = rows.reduce((m, r) => Math.max(m, r.sort_order), -1);
    const { data: inserted, error: insE } = await supabase
      .from("professionals")
      .insert({
        clinic_id: clinicId,
        name: n,
        specialty: specialty.trim() || null,
        whatsapp: newWhatsapp.trim() || null,
        is_active: true,
        sort_order: maxSort + 1,
        panel_color: newColor,
        avatar_emoji: newEmoji.trim() || null,
        avatar_path: null,
      })
      .select("id")
      .single();
    if (insE || !inserted) {
      setBusy(null);
      setError(insE?.message ?? "Erro ao criar profissional.");
      return;
    }

    let uploadErr: string | null = null;
    if (newPhotoFile) {
      const ext = guessImageExt(newPhotoFile);
      const path = storagePathForProfessionalAvatar(
        clinicId,
        inserted.id,
        ext
      );
      const { error: up } = await supabase.storage
        .from(PROFESSIONAL_AVATAR_BUCKET)
        .upload(path, newPhotoFile, {
          upsert: true,
          contentType: newPhotoFile.type || "image/jpeg",
        });
      if (up) uploadErr = up.message;
      else {
        const { error: pu } = await supabase
          .from("professionals")
          .update({ avatar_path: path })
          .eq("id", inserted.id)
          .eq("clinic_id", clinicId);
        if (pu) uploadErr = pu.message;
      }
    }

    setBusy(null);
    if (uploadErr) {
      setError(`Profissional criado, mas a foto não foi guardada: ${uploadErr}`);
    }
    setName("");
    setSpecialty("");
    setNewWhatsapp("");
    setNewColor(DEFAULT_PROFESSIONAL_PANEL_COLOR);
    setNewEmoji("");
    setNewPhotoFile(null);
    setNewPhotoPreview((prev) => {
      revokePreview(prev);
      return null;
    });
    await load();
    onChanged();
  }

  function onPickNewPhoto(file: File | null) {
    setNewPhotoFile(file);
    setNewPhotoPreview((prev) => {
      revokePreview(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }

  async function updateRowEmoji(r: Row, emoji: string | null) {
    setBusy(r.id);
    setError(null);
    const { error: u } = await supabase
      .from("professionals")
      .update({ avatar_emoji: emoji })
      .eq("id", r.id)
      .eq("clinic_id", clinicId);
    setBusy(null);
    if (u) {
      setError(u.message);
      return;
    }
    await load();
    onChanged();
  }

  async function uploadRowPhoto(r: Row, file: File | null) {
    if (!file) return;
    setBusy(r.id);
    setError(null);
    const ext = guessImageExt(file);
    const path = storagePathForProfessionalAvatar(clinicId, r.id, ext);
    const oldPath = r.avatar_path;
    const { error: up } = await supabase.storage
      .from(PROFESSIONAL_AVATAR_BUCKET)
      .upload(path, file, {
        upsert: true,
        contentType: file.type || "image/jpeg",
      });
    if (up) {
      setError(up.message);
      setBusy(null);
      return;
    }
    const { error: pu } = await supabase
      .from("professionals")
      .update({ avatar_path: path })
      .eq("id", r.id)
      .eq("clinic_id", clinicId);
    if (pu) {
      setError(pu.message);
      setBusy(null);
      return;
    }
    if (oldPath && oldPath !== path) {
      await supabase.storage.from(PROFESSIONAL_AVATAR_BUCKET).remove([oldPath]);
    }
    setBusy(null);
    await load();
    onChanged();
  }

  async function clearRowPhoto(r: Row) {
    if (!r.avatar_path) return;
    setBusy(r.id);
    setError(null);
    await supabase.storage
      .from(PROFESSIONAL_AVATAR_BUCKET)
      .remove([r.avatar_path]);
    const { error: pu } = await supabase
      .from("professionals")
      .update({ avatar_path: null })
      .eq("id", r.id)
      .eq("clinic_id", clinicId);
    setBusy(null);
    if (pu) {
      setError(pu.message);
      return;
    }
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

  async function updatePanelColor(r: Row, value: string) {
    setBusy(r.id);
    setError(null);
    const { error: u } = await supabase
      .from("professionals")
      .update({ panel_color: value })
      .eq("id", r.id)
      .eq("clinic_id", clinicId);
    setBusy(null);
    if (u) {
      setError(u.message);
      return;
    }
    await load();
    onChanged();
  }

  function startEditRow(r: Row) {
    setEditingId(r.id);
    setEditName(r.name);
    setEditSpecialty(r.specialty ?? "");
    setEditWhatsapp(r.whatsapp ?? "");
    setError(null);
    if (r.agenda_hours && r.agenda_hours.length > 0) {
      setEditAgendaCustom(true);
      setEditAgendaHours(new Set(r.agenda_hours));
    } else {
      setEditAgendaCustom(false);
      setEditAgendaHours(new Set());
    }
  }

  function cancelEditRow() {
    setEditingId(null);
    setEditName("");
    setEditSpecialty("");
    setEditWhatsapp("");
    setEditAgendaCustom(false);
    setEditAgendaHours(new Set());
  }

  async function saveRowDetails(r: Row) {
    const n = editName.trim();
    if (!n) {
      setError("Indique o nome do profissional.");
      return;
    }
    setBusy(r.id);
    setError(null);
    const agendaHours = editAgendaCustom && editAgendaHours.size > 0
      ? [...editAgendaHours].sort((a, b) => a - b)
      : null;

    const { error: u } = await supabase
      .from("professionals")
      .update({ name: n, specialty: editSpecialty.trim() || null, whatsapp: editWhatsapp.trim() || null, agenda_hours: agendaHours })
      .eq("id", r.id)
      .eq("clinic_id", clinicId);
    if (u) {
      setBusy(null);
      setError(u.message);
      return;
    }

    setBusy(null);
    cancelEditRow();
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
    if (r.avatar_path) {
      await supabase.storage
        .from(PROFESSIONAL_AVATAR_BUCKET)
        .remove([r.avatar_path]);
    }
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
    setEditingId(null);
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
      <div>
        <p className="mb-1 text-xs font-semibold text-[#5c5348]">WhatsApp para notificações (opcional)</p>
        <input
          placeholder="Ex.: 5511999999999"
          value={newWhatsapp}
          onChange={(e) => setNewWhatsapp(e.target.value)}
          className="w-full rounded-xl border border-[#d4cfc4] px-3 py-2.5 text-sm text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
        />
        <p className="mt-1 text-[11px] text-[#8a8278]">Código do país + DDD + número, sem espaços ou traços.</p>
      </div>
      <div className="rounded-2xl border border-[#e6e1d8] bg-[#faf8f4] p-4">
        <p className="text-xs font-semibold text-[#5c5348]">Avatar</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[#8a8278]">
          Foto primeiro; sem foto, o emoji; sem emoji, as iniciais do nome.
        </p>
        <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9a9288]">
              Pré-visualização
            </p>
            <ProfessionalAvatar
              name={name.trim() || "Profissional"}
              photoUrl={newPhotoPreview ?? undefined}
              emoji={newEmoji || null}
              panelColor={newColor}
              size="lg"
            />
          </div>
          <div className="w-full min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-xs font-semibold text-[#5c5348]">Foto (opcional)</p>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={busy === "add"}
                className="mt-1 block w-full text-sm text-[#5c5348] file:mr-2 file:rounded-lg file:border-0 file:bg-[#e6f5f3] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#0f766e] hover:file:bg-[#d4efe9]"
                onChange={(e) =>
                  onPickNewPhoto(e.target.files?.[0] ?? null)
                }
              />
              {newPhotoPreview ? (
                <button
                  type="button"
                  disabled={busy === "add"}
                  onClick={() => onPickNewPhoto(null)}
                  className="mt-2 text-xs font-medium text-[#b45309] hover:underline disabled:opacity-50"
                >
                  Remover foto
                </button>
              ) : null}
            </div>
            <EmojiFallbackPicker
              value={newEmoji}
              onChange={setNewEmoji}
              disabled={busy === "add"}
            />
          </div>
        </div>
      </div>
      <ProfessionalPanelColorField
        value={newColor}
        onChange={setNewColor}
        disabled={busy === "add"}
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
            rows.map((r) => {
              const isEditing = editingId === r.id;
              const displayName = isEditing
                ? editName.trim() || r.name
                : r.name;
              return (
              <li
                key={r.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3 shadow-sm ${
                  isEditing
                    ? "border-[#0f766e]/40 ring-1 ring-[#0f766e]/20"
                    : "border-[#ebe6dd]"
                }`}
              >
                <ProfessionalAvatar
                  name={displayName}
                  photoUrl={professionalAvatarPublicUrl(supabase, r.avatar_path)}
                  emoji={r.avatar_emoji}
                  panelColor={rowPaletteValue(r)}
                  size="md"
                  className="self-start"
                />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        aria-label="Nome do profissional"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full rounded-xl border border-[#d4cfc4] px-3 py-2 text-sm font-medium text-[#2c2825] outline-none ring-[#4D6D66] focus:ring-2"
                      />
                      <input
                        aria-label="Especialidade"
                        placeholder="Área / especialidade (opcional)"
                        value={editSpecialty}
                        onChange={(e) => setEditSpecialty(e.target.value)}
                        className="w-full rounded-xl border border-[#d4cfc4] px-3 py-2 text-sm text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
                      />
                      <div>
                        <p className="text-[11px] font-semibold text-[#5c5348]">WhatsApp para notificações</p>
                        <input
                          aria-label="WhatsApp do profissional"
                          placeholder="5511999999999"
                          value={editWhatsapp}
                          onChange={(e) => setEditWhatsapp(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-[#d4cfc4] px-3 py-2 text-sm text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="font-medium text-[#2c2825]">{r.name}</p>
                      {r.specialty ? (
                        <p className="text-xs text-[#7a7268]">{r.specialty}</p>
                      ) : null}
                      {r.whatsapp ? (
                        <p className="mt-0.5 text-[11px] text-[#0f766e]">📲 {r.whatsapp}</p>
                      ) : null}
                    </>
                  )}
                  {!r.is_active ? (
                    <span className="mt-1 inline-block rounded bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-700">
                      Inativo
                    </span>
                  ) : null}
                  {isEditing ? (
                    <>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <label className="cursor-pointer rounded-lg border border-[#e6e1d8] bg-[#faf8f4] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#6b635a] hover:bg-[#f0ebe3]">
                          Foto
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            className="sr-only"
                            disabled={busy === r.id}
                            onChange={(e) => {
                              const f = e.target.files?.[0] ?? null;
                              e.target.value = "";
                              if (f) void uploadRowPhoto(r, f);
                            }}
                          />
                        </label>
                        {r.avatar_path ? (
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => void clearRowPhoto(r)}
                            className="rounded-lg border border-[#fde68a] bg-[#fffbeb] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#92400e] disabled:opacity-50"
                          >
                            Sem foto
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-2">
                        <EmojiFallbackPicker
                          value={r.avatar_emoji ?? ""}
                          onChange={(em) =>
                            void updateRowEmoji(r, em.trim() || null)
                          }
                          disabled={busy === r.id}
                          label="Emoji de reserva"
                        />
                      </div>
                      <RowColorSwatches
                        row={r}
                        busy={busy === r.id}
                        onPick={(v) => void updatePanelColor(r, v)}
                      />
                      {/* Horários de atendimento */}
                      <div className="mt-3 rounded-xl border border-[#e6e1d8] bg-[#faf8f4] p-3">
                        <p className="text-xs font-semibold text-[#5c5348]">Horários de atendimento</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => setEditAgendaCustom(false)}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                              !editAgendaCustom
                                ? "border-[#0f766e] bg-[#e6f5f3] text-[#0f766e]"
                                : "border-[#d4cfc4] bg-white text-[#6b635a] hover:bg-[#f0ebe3]"
                            }`}
                          >
                            Padrão da clínica
                          </button>
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => {
                              setEditAgendaCustom(true);
                              if (editAgendaHours.size === 0) {
                                setEditAgendaHours(new Set([8, 9, 10, 11, 14, 15, 16, 17]));
                              }
                            }}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                              editAgendaCustom
                                ? "border-[#0f766e] bg-[#e6f5f3] text-[#0f766e]"
                                : "border-[#d4cfc4] bg-white text-[#6b635a] hover:bg-[#f0ebe3]"
                            }`}
                          >
                            Personalizado
                          </button>
                        </div>
                        {editAgendaCustom && (
                          <div className="mt-2 grid gap-1 [grid-template-columns:repeat(auto-fit,minmax(4.5rem,1fr))]">
                            {FULL_CLINIC_AGENDA_HOURS.map((h) => {
                              const on = editAgendaHours.has(h);
                              return (
                                <button
                                  key={h}
                                  type="button"
                                  disabled={busy === r.id}
                                  onClick={() => {
                                    setEditAgendaHours((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(h)) {
                                        if (next.size > 1) next.delete(h);
                                      } else {
                                        next.add(h);
                                      }
                                      return next;
                                    });
                                  }}
                                  className={`rounded-lg border py-1.5 text-xs font-semibold tabular-nums transition-colors disabled:opacity-50 ${
                                    on
                                      ? "border-teal-700/70 bg-teal-950/90 text-teal-100"
                                      : "border-dashed border-[#d4cfc4] bg-white text-[#9a9288] line-through"
                                  }`}
                                >
                                  {formatAgendaHourLabel(h)}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {!editAgendaCustom && (
                          <p className="mt-1.5 text-[11px] text-[#8a8278]">
                            Usa os horários configurados em «Horários da clínica».
                          </p>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:flex-wrap">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => void saveRowDetails(r)}
                        className="rounded-lg border border-[#0f766e] bg-[#0f766e] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#0d6560] disabled:opacity-50"
                      >
                        {busy === r.id ? "A guardar…" : "Guardar"}
                      </button>
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={cancelEditRow}
                        className="rounded-lg border border-[#ddd8cf] bg-white px-3 py-1.5 text-xs font-medium text-[#4a453d] hover:bg-[#f7f4ef] disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy === r.id || editingId != null}
                        onClick={() => startEditRow(r)}
                        className="rounded-lg border border-[#c5d9d4] bg-[#f0f9f8] px-3 py-1.5 text-xs font-semibold text-[#0f766e] hover:bg-[#e6f5f3] disabled:opacity-50"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        disabled={busy === r.id || editingId != null}
                        onClick={() => void toggleActive(r)}
                        className="rounded-lg border border-[#ddd8cf] px-3 py-1.5 text-xs font-medium text-[#4a453d] hover:bg-[#f7f4ef] disabled:opacity-50"
                      >
                        {r.is_active ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        type="button"
                        disabled={busy === r.id || editingId != null}
                        onClick={() => void removeRow(r)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                      >
                        Apagar
                      </button>
                    </>
                  )}
                </div>
              </li>
              );
            })
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
            <div className="rounded-xl border border-[#e6e1d8] bg-[#faf8f4] p-3">
              <p className="text-xs font-semibold text-[#5c5348]">Avatar</p>
              <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                <div className="flex flex-col items-center gap-1">
                  <ProfessionalAvatar
                    name={name.trim() || "Profissional"}
                    photoUrl={newPhotoPreview ?? undefined}
                    emoji={newEmoji || null}
                    panelColor={newColor}
                    size="lg"
                  />
                  <span className="text-[10px] text-[#9a9288]">Pré-visualização</span>
                </div>
                <div className="w-full min-w-0 flex-1 space-y-2">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    disabled={busy === "add"}
                    className="block w-full text-xs text-[#5c5348] file:mr-2 file:rounded-md file:border-0 file:bg-[#e6f5f3] file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-[#0f766e]"
                    onChange={(e) =>
                      onPickNewPhoto(e.target.files?.[0] ?? null)
                    }
                  />
                  {newPhotoPreview ? (
                    <button
                      type="button"
                      disabled={busy === "add"}
                      onClick={() => onPickNewPhoto(null)}
                      className="text-[11px] font-medium text-[#b45309] hover:underline disabled:opacity-50"
                    >
                      Remover foto
                    </button>
                  ) : null}
                  <EmojiFallbackPicker
                    value={newEmoji}
                    onChange={setNewEmoji}
                    disabled={busy === "add"}
                  />
                </div>
              </div>
            </div>
            <ProfessionalPanelColorField
              value={newColor}
              onChange={setNewColor}
              disabled={busy === "add"}
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
                rows.map((r) => {
                  const isEditing = editingId === r.id;
                  const displayName = isEditing
                    ? editName.trim() || r.name
                    : r.name;
                  return (
                  <li
                    key={r.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-3 py-3 ${
                      isEditing
                        ? "border-[#4D6D66]/50 ring-1 ring-[#4D6D66]/25"
                        : "border-[#e6e1d8]"
                    }`}
                  >
                    <ProfessionalAvatar
                      name={displayName}
                      photoUrl={professionalAvatarPublicUrl(supabase, r.avatar_path)}
                      emoji={r.avatar_emoji}
                      panelColor={rowPaletteValue(r)}
                      size="md"
                      className="self-start"
                    />
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="space-y-1.5">
                          <input
                            aria-label="Nome do profissional"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full rounded-lg border border-[#d4cfc4] px-2 py-1.5 text-sm font-medium text-[#2c2825] outline-none ring-[#4D6D66] focus:ring-2"
                          />
                          <input
                            aria-label="Especialidade"
                            placeholder="Área / especialidade (opcional)"
                            value={editSpecialty}
                            onChange={(e) => setEditSpecialty(e.target.value)}
                            className="w-full rounded-lg border border-[#d4cfc4] px-2 py-1.5 text-sm text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2"
                          />
                        </div>
                      ) : (
                        <>
                          <p className="font-medium text-[#2c2825]">{r.name}</p>
                          {r.specialty ? (
                            <p className="text-xs text-[#7a7268]">{r.specialty}</p>
                          ) : null}
                        </>
                      )}
                      {!r.is_active ? (
                        <span className="mt-1 inline-block rounded bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-700">
                          Inativo
                        </span>
                      ) : null}
                      {isEditing ? (
                        <>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <label className="cursor-pointer rounded border border-[#e6e1d8] bg-[#faf8f4] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#6b635a]">
                              Foto
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                className="sr-only"
                                disabled={busy === r.id}
                                onChange={(e) => {
                                  const f = e.target.files?.[0] ?? null;
                                  e.target.value = "";
                                  if (f) void uploadRowPhoto(r, f);
                                }}
                              />
                            </label>
                            {r.avatar_path ? (
                              <button
                                type="button"
                                disabled={busy === r.id}
                                onClick={() => void clearRowPhoto(r)}
                                className="rounded border border-[#fde68a] bg-[#fffbeb] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#92400e] disabled:opacity-50"
                              >
                                Sem foto
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-2">
                            <EmojiFallbackPicker
                              value={r.avatar_emoji ?? ""}
                              onChange={(em) =>
                                void updateRowEmoji(r, em.trim() || null)
                              }
                              disabled={busy === r.id}
                              label="Emoji"
                            />
                          </div>
                          <RowColorSwatches
                            row={r}
                            busy={busy === r.id}
                            onPick={(v) => void updatePanelColor(r, v)}
                          />
                        </>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:flex-wrap">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => void saveRowDetails(r)}
                            className="rounded-lg border border-[#4D6D66] bg-[#4D6D66] px-2 py-1.5 text-xs font-semibold text-white hover:bg-[#3f5c56] disabled:opacity-50"
                          >
                            {busy === r.id ? "…" : "Guardar"}
                          </button>
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={cancelEditRow}
                            className="rounded-lg border border-[#ddd8cf] bg-white px-2 py-1.5 text-xs font-medium text-[#4a453d] hover:bg-[#f7f4ef] disabled:opacity-50"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy === r.id || editingId != null}
                            onClick={() => startEditRow(r)}
                            className="rounded-lg border border-[#c5d9d4] bg-[#f0f9f8] px-2 py-1.5 text-xs font-semibold text-[#0f766e] hover:bg-[#e6f5f3] disabled:opacity-50"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={busy === r.id || editingId != null}
                            onClick={() => void toggleActive(r)}
                            className="rounded-lg border border-[#ddd8cf] px-2 py-1.5 text-xs font-medium text-[#4a453d] hover:bg-[#f7f4ef] disabled:opacity-50"
                          >
                            {r.is_active ? "Desativar" : "Ativar"}
                          </button>
                          <button
                            type="button"
                            disabled={busy === r.id || editingId != null}
                            onClick={() => void removeRow(r)}
                            className="rounded-lg border border-red-200 px-2 py-1.5 text-xs font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                          >
                            Apagar
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                  );
                })
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
