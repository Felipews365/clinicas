"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Props = { supabase: SupabaseClient; clinicId: string };

type PatientRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
};

type Ficha = {
  alergias: string;
  condicoes_cronicas: string;
  medicacoes_uso: string;
  tipo_sanguineo: string;
  observacoes: string;
};

type RegistroRow = {
  id: string;
  tipo: "anamnese" | "evolucao" | "atestado" | "nota";
  titulo: string | null;
  conteudo: string;
  professional_id: string | null;
  created_at: string;
};

type AnexoRow = {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type ProfRow = { id: string; name: string | null };

type Tab = "ficha" | "evolucoes" | "anexos";

const EMPTY_FICHA: Ficha = {
  alergias: "",
  condicoes_cronicas: "",
  medicacoes_uso: "",
  tipo_sanguineo: "",
  observacoes: "",
};

const TIPO_LABEL: Record<RegistroRow["tipo"], string> = {
  anamnese: "Anamnese",
  evolucao: "Evolução",
  atestado: "Atestado",
  nota: "Nota",
};

const TIPO_COLOR: Record<RegistroRow["tipo"], string> = {
  anamnese: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  evolucao: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  atestado: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  nota: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png"];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProntuarioPanel({ supabase, clinicId }: Props) {
  // ------- lista de pacientes -------
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [patientsError, setPatientsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ------- profissionais (dropdown) -------
  const [profs, setProfs] = useState<ProfRow[]>([]);

  // ------- detalhe -------
  const [tab, setTab] = useState<Tab>("ficha");

  const loadPatients = useCallback(async () => {
    setLoadingPatients(true);
    setPatientsError(null);
    const { data, error } = await supabase
      .from("patients")
      .select("id, name, phone, email")
      .eq("clinic_id", clinicId)
      .order("name", { ascending: true });
    setLoadingPatients(false);
    if (error) {
      setPatientsError(error.message);
      return;
    }
    setPatients((data as PatientRow[]) ?? []);
  }, [supabase, clinicId]);

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  useEffect(() => {
    let alive = true;
    void supabase
      .from("professionals")
      .select("id, name")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .then(({ data }) => {
        if (alive) setProfs((data as ProfRow[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [supabase, clinicId]);

  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        (p.name ?? "").toLowerCase().includes(q) ||
        (p.phone ?? "").toLowerCase().includes(q),
    );
  }, [patients, search]);

  const selectedPatient = useMemo(
    () => patients.find((p) => p.id === selectedId) ?? null,
    [patients, selectedId],
  );

  return (
    <div className="flex h-full min-h-0 w-full gap-4">
      {/* ---------- Coluna esquerda: pacientes ---------- */}
      <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="shrink-0 border-b border-[var(--border)] p-3">
          <h1 className="font-display text-base font-semibold text-[var(--text)]">Prontuário</h1>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar paciente…"
            className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loadingPatients ? (
            <p className="p-4 text-sm text-[var(--text-muted)]">A carregar…</p>
          ) : patientsError ? (
            <p className="p-4 text-sm text-red-600 dark:text-red-400">{patientsError}</p>
          ) : filteredPatients.length === 0 ? (
            <p className="p-4 text-sm text-[var(--text-muted)]">
              {patients.length === 0 ? "Nenhum paciente cadastrado ainda." : "Nenhum resultado."}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {filteredPatients.map((p) => {
                const nome = p.name?.trim() || p.phone || "Sem nome";
                const active = p.id === selectedId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(p.id);
                        setTab("ficha");
                      }}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        active ? "bg-[var(--primary)]/10" : "hover:bg-[var(--surface-soft)]"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                          active
                            ? "bg-[var(--primary)]/20 text-[var(--primary)]"
                            : "bg-[var(--surface-soft)] text-[var(--text-muted)]"
                        }`}
                      >
                        {(p.name?.trim()?.[0] ?? "?").toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--text)]">{nome}</span>
                        {p.phone ? (
                          <span className="block truncate text-xs text-[var(--text-muted)]">{p.phone}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ---------- Coluna direita: detalhe ---------- */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        {!selectedPatient ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
            </svg>
            <p className="text-sm text-[var(--text-muted)]">Selecione um paciente para ver o prontuário.</p>
          </div>
        ) : (
          <PatientProntuario
            key={selectedPatient.id}
            supabase={supabase}
            clinicId={clinicId}
            patient={selectedPatient}
            profs={profs}
            tab={tab}
            setTab={setTab}
          />
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Detalhe de um paciente
// ===========================================================================
function PatientProntuario({
  supabase,
  clinicId,
  patient,
  profs,
  tab,
  setTab,
}: {
  supabase: SupabaseClient;
  clinicId: string;
  patient: PatientRow;
  profs: ProfRow[];
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const profName = useCallback(
    (id: string | null) => (id ? profs.find((p) => p.id === id)?.name ?? null : null),
    [profs],
  );

  const tabClass = (t: Tab) =>
    `px-4 py-2.5 text-sm font-semibold transition-colors ${
      tab === t
        ? "text-[var(--primary)] border-b-2 border-[var(--primary)]"
        : "text-[var(--text-muted)] hover:text-[var(--text)] border-b-2 border-transparent"
    }`;

  return (
    <>
      {/* cabeçalho */}
      <div className="shrink-0 border-b border-[var(--border)] px-5 py-3">
        <h2 className="font-display text-lg font-semibold text-[var(--text)]">
          {patient.name?.trim() || patient.phone || "Sem nome"}
        </h2>
        <p className="text-xs text-[var(--text-muted)]">
          {[patient.phone, patient.email].filter(Boolean).join(" · ") || "Sem contacto"}
        </p>
      </div>

      {/* abas */}
      <div className="flex shrink-0 gap-1 border-b border-[var(--border)] px-3">
        <button type="button" className={tabClass("ficha")} onClick={() => setTab("ficha")}>
          Ficha
        </button>
        <button type="button" className={tabClass("evolucoes")} onClick={() => setTab("evolucoes")}>
          Evoluções
        </button>
        <button type="button" className={tabClass("anexos")} onClick={() => setTab("anexos")}>
          Anexos
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === "ficha" ? (
          <FichaTab supabase={supabase} clinicId={clinicId} patientId={patient.id} />
        ) : tab === "evolucoes" ? (
          <EvolucoesTab supabase={supabase} clinicId={clinicId} patientId={patient.id} profs={profs} profName={profName} />
        ) : (
          <AnexosTab supabase={supabase} clinicId={clinicId} patientId={patient.id} />
        )}
      </div>
    </>
  );
}

// ===========================================================================
// Aba Ficha
// ===========================================================================
function FichaTab({
  supabase,
  clinicId,
  patientId,
}: {
  supabase: SupabaseClient;
  clinicId: string;
  patientId: string;
}) {
  const [ficha, setFicha] = useState<Ficha>(EMPTY_FICHA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void supabase
      .from("cs_prontuario_ficha")
      .select("alergias, condicoes_cronicas, medicacoes_uso, tipo_sanguineo, observacoes")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (!alive) return;
        setLoading(false);
        if (e) {
          setError(e.message);
          return;
        }
        setFicha(
          data
            ? {
                alergias: data.alergias ?? "",
                condicoes_cronicas: data.condicoes_cronicas ?? "",
                medicacoes_uso: data.medicacoes_uso ?? "",
                tipo_sanguineo: data.tipo_sanguineo ?? "",
                observacoes: data.observacoes ?? "",
              }
            : EMPTY_FICHA,
        );
      });
    return () => {
      alive = false;
    };
  }, [supabase, clinicId, patientId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from("cs_prontuario_ficha").upsert(
      {
        clinic_id: clinicId,
        patient_id: patientId,
        alergias: ficha.alergias.trim() || null,
        condicoes_cronicas: ficha.condicoes_cronicas.trim() || null,
        medicacoes_uso: ficha.medicacoes_uso.trim() || null,
        tipo_sanguineo: ficha.tipo_sanguineo.trim() || null,
        observacoes: ficha.observacoes.trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clinic_id,patient_id" },
    );
    setSaving(false);
    if (e) {
      setError(e.message);
      return;
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  const field = (label: string, key: keyof Ficha, rows = 2, placeholder = "") => (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</label>
      <textarea
        rows={rows}
        value={ficha[key]}
        onChange={(e) => setFicha((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
      />
    </div>
  );

  if (loading) return <p className="text-sm text-[var(--text-muted)]">A carregar ficha…</p>;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tipo sanguíneo</label>
        <input
          type="text"
          value={ficha.tipo_sanguineo}
          onChange={(e) => setFicha((f) => ({ ...f, tipo_sanguineo: e.target.value }))}
          placeholder="Ex.: O+"
          className="w-32 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
        />
      </div>
      {field("Alergias", "alergias", 2, "Ex.: penicilina, látex…")}
      {field("Condições crônicas", "condicoes_cronicas", 2, "Ex.: hipertensão, diabetes…")}
      {field("Medicações em uso", "medicacoes_uso", 2)}
      {field("Observações gerais", "observacoes", 4)}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
        >
          {saving ? "A guardar…" : "Guardar ficha"}
        </button>
        {savedFlash ? <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">✓ Guardado</span> : null}
      </div>
    </div>
  );
}

// ===========================================================================
// Aba Evoluções
// ===========================================================================
function EvolucoesTab({
  supabase,
  clinicId,
  patientId,
  profs,
  profName,
}: {
  supabase: SupabaseClient;
  clinicId: string;
  patientId: string;
  profs: ProfRow[];
  profName: (id: string | null) => string | null;
}) {
  const [rows, setRows] = useState<RegistroRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [tipo, setTipo] = useState<RegistroRow["tipo"]>("evolucao");
  const [titulo, setTitulo] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [profId, setProfId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("cs_prontuario_registros")
      .select("id, tipo, titulo, conteudo, professional_id, created_at")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    setRows((data as RegistroRow[]) ?? []);
  }, [supabase, clinicId, patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setTipo("evolucao");
    setTitulo("");
    setConteudo("");
    setProfId("");
    setShowForm(false);
  };

  const save = async () => {
    if (!conteudo.trim()) return;
    setSaving(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const { error: e } = await supabase.from("cs_prontuario_registros").insert({
      clinic_id: clinicId,
      patient_id: patientId,
      professional_id: profId || null,
      tipo,
      titulo: titulo.trim() || null,
      conteudo: conteudo.trim(),
      created_by: userData?.user?.id ?? null,
    });
    setSaving(false);
    if (e) {
      setError(e.message);
      return;
    }
    resetForm();
    void load();
  };

  const remove = async (id: string) => {
    const { error: e } = await supabase
      .from("cs_prontuario_registros")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", id);
    if (e) {
      setError(e.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="self-start rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-95"
        >
          + Nova evolução
        </button>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tipo</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as RegistroRow["tipo"])}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
              >
                <option value="evolucao">Evolução</option>
                <option value="anamnese">Anamnese</option>
                <option value="atestado">Atestado</option>
                <option value="nota">Nota</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Profissional</label>
              <select
                value={profId}
                onChange={(e) => setProfId(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
              >
                <option value="">— Nenhum —</option>
                {profs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Título (opcional)</label>
            <input
              type="text"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Conteúdo</label>
            <textarea
              rows={5}
              value={conteudo}
              onChange={(e) => setConteudo(e.target.value)}
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !conteudo.trim()}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
            >
              {saving ? "A guardar…" : "Guardar"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">A carregar evoluções…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Nenhuma evolução registada ainda.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase ${TIPO_COLOR[r.tipo]}`}>
                  {TIPO_LABEL[r.tipo]}
                </span>
                {r.titulo ? <span className="text-sm font-semibold text-[var(--text)]">{r.titulo}</span> : null}
                <span className="ml-auto text-xs text-[var(--text-muted)]">{fmtDate(r.created_at)}</span>
                <button
                  type="button"
                  onClick={() => void remove(r.id)}
                  className="text-[var(--text-muted)] transition-colors hover:text-red-500"
                  title="Apagar"
                  aria-label="Apagar evolução"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  </svg>
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm text-[var(--text)]">{r.conteudo}</p>
              {profName(r.professional_id) ? (
                <p className="mt-2 text-xs text-[var(--text-muted)]">— {profName(r.professional_id)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ===========================================================================
// Aba Anexos
// ===========================================================================
function AnexosTab({
  supabase,
  clinicId,
  patientId,
}: {
  supabase: SupabaseClient;
  clinicId: string;
  patientId: string;
}) {
  const [rows, setRows] = useState<AnexoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("cs_prontuario_anexos")
      .select("id, file_name, storage_path, mime_type, size_bytes, created_at")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    setRows((data as AnexoRow[]) ?? []);
  }, [supabase, clinicId, patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPickFile = async (file: File) => {
    setError(null);
    if (!ALLOWED_MIME.includes(file.type)) {
      setError("Formato não permitido. Aceites: PDF, JPG, PNG.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("Arquivo maior que 10 MB.");
      return;
    }
    setUploading(true);
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${clinicId}/${patientId}/${Date.now()}_${safeName}`;
    const { error: upErr } = await supabase.storage.from("prontuario").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (upErr) {
      setUploading(false);
      setError(upErr.message);
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const { error: insErr } = await supabase.from("cs_prontuario_anexos").insert({
      clinic_id: clinicId,
      patient_id: patientId,
      file_name: file.name,
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      created_by: userData?.user?.id ?? null,
    });
    setUploading(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    void load();
  };

  const openFile = async (row: AnexoRow) => {
    const { data, error: e } = await supabase.storage.from("prontuario").createSignedUrl(row.storage_path, 120);
    if (e) {
      setError(e.message);
      return;
    }
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const remove = async (row: AnexoRow) => {
    setError(null);
    const { error: stErr } = await supabase.storage.from("prontuario").remove([row.storage_path]);
    if (stErr) {
      setError(stErr.message);
      return;
    }
    const { error: dbErr } = await supabase
      .from("cs_prontuario_anexos")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("id", row.id);
    if (dbErr) {
      setError(dbErr.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPickFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
        >
          {uploading ? "A enviar…" : "+ Enviar anexo"}
        </button>
        <p className="mt-1 text-xs text-[var(--text-muted)]">PDF, JPG ou PNG · máx. 10 MB</p>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--text-muted)]">A carregar anexos…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Nenhum anexo enviado ainda.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-2.5">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-[var(--text-muted)]">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
              <button type="button" onClick={() => void openFile(r)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium text-[var(--primary)] hover:underline">{r.file_name}</span>
                <span className="block text-xs text-[var(--text-muted)]">
                  {fmtSize(r.size_bytes)} · {fmtDate(r.created_at)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void remove(r)}
                className="shrink-0 text-[var(--text-muted)] transition-colors hover:text-red-500"
                title="Apagar"
                aria-label="Apagar anexo"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
