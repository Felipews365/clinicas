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

type Tipo = "anamnese" | "evolucao" | "atestado" | "nota" | "receita" | "declaracao";

type RegistroRow = {
  id: string;
  tipo: Tipo;
  titulo: string | null;
  conteudo: string;
  professional_id: string | null;
  appointment_id: string | null;
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

type ProfRow = { id: string; name: string | null; specialty: string | null };

type AppointmentRow = {
  id: string;
  starts_at: string;
  service_name: string | null;
  professional_id: string | null;
  status: string | null;
};

type ClinicHeader = { name: string; phone: string | null; endereco: string | null };

type Tab = "ficha" | "evolucoes" | "documentos" | "anexos";

const EMPTY_FICHA: Ficha = {
  alergias: "",
  condicoes_cronicas: "",
  medicacoes_uso: "",
  tipo_sanguineo: "",
  observacoes: "",
};

// Tipos clínicos (aba Evoluções) vs documentos (aba Documentos)
const CLINICAL_TIPOS: Tipo[] = ["evolucao", "anamnese", "nota"];
const DOC_TIPOS: Tipo[] = ["atestado", "receita", "declaracao"];

const TIPO_LABEL: Record<Tipo, string> = {
  anamnese: "Anamnese",
  evolucao: "Evolução",
  atestado: "Atestado",
  nota: "Nota",
  receita: "Receita",
  declaracao: "Declaração",
};

const TIPO_COLOR: Record<Tipo, string> = {
  anamnese: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  evolucao: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  atestado: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  nota: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  receita: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  declaracao: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
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

function fmtApptLabel(a: AppointmentRow): string {
  const d = new Date(a.starts_at);
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return a.service_name ? `${date} ${time} · ${a.service_name}` : `${date} ${time}`;
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Impressão (gera PDF via diálogo do navegador, sem lib externa)
// ---------------------------------------------------------------------------
function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(s: string): string {
  return esc(s).replace(/\n/g, "<br>");
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; padding: 40px 48px; }
  .clinic-header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 24px; }
  .clinic-header h1 { font-size: 20px; margin: 0 0 4px; }
  .clinic-header p { font-size: 12px; margin: 2px 0; color: #444; }
  .doc-title { font-size: 16px; text-transform: uppercase; letter-spacing: 1px; text-align: center; margin: 8px 0 24px; }
  .meta { font-size: 13px; margin: 4px 0; }
  .meta strong { font-weight: 600; }
  .body-text { font-size: 14px; line-height: 1.7; margin: 24px 0; text-align: justify; white-space: pre-wrap; }
  .signature { margin-top: 72px; text-align: center; font-size: 13px; }
  .signature .line { width: 260px; border-top: 1px solid #111; margin: 0 auto 6px; }
  .place-date { text-align: right; font-size: 13px; margin-top: 40px; }
  .section-title { font-size: 14px; font-weight: 700; margin: 20px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  .ficha-row { font-size: 13px; margin: 3px 0; }
  .reg { margin: 0 0 14px; padding: 10px 0; border-bottom: 1px solid #eee; }
  .reg .reg-head { font-size: 12px; color: #555; margin-bottom: 4px; }
  .reg .reg-tag { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-right: 6px; }
  .reg .reg-body { font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
  @media print { body { padding: 0; } }
`;

function openPrint(title: string, bodyHtml: string) {
  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) {
    // popup bloqueado
    alert("Permita pop-ups para imprimir/gerar PDF.");
    return;
  }
  w.document.write(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(
      title,
    )}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}` +
      `<scr` +
      `ipt>window.onload=function(){setTimeout(function(){window.focus();window.print();},150);};</scr` +
      `ipt></body></html>`,
  );
  w.document.close();
}

function clinicHeaderHtml(clinic: ClinicHeader): string {
  return (
    `<div class="clinic-header"><h1>${esc(clinic.name)}</h1>` +
    (clinic.endereco ? `<p>${esc(clinic.endereco)}</p>` : "") +
    (clinic.phone ? `<p>Tel.: ${esc(clinic.phone)}</p>` : "") +
    `</div>`
  );
}

function signatureHtml(prof: ProfRow | null): string {
  if (!prof) return "";
  return (
    `<div class="signature"><div class="line"></div>` +
    `${esc(prof.name)}${prof.specialty ? ` — ${esc(prof.specialty)}` : ""}</div>`
  );
}

function printDocumento(
  clinic: ClinicHeader,
  patient: PatientRow,
  reg: RegistroRow,
  prof: ProfRow | null,
) {
  const patientName = patient.name?.trim() || patient.phone || "Paciente";
  const placeDate = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const body =
    clinicHeaderHtml(clinic) +
    `<div class="doc-title">${esc(TIPO_LABEL[reg.tipo])}</div>` +
    `<p class="meta"><strong>Paciente:</strong> ${esc(patientName)}</p>` +
    (reg.titulo ? `<p class="meta"><strong>Assunto:</strong> ${esc(reg.titulo)}</p>` : "") +
    `<div class="body-text">${nl2br(reg.conteudo)}</div>` +
    `<div class="place-date">${esc(placeDate)}</div>` +
    signatureHtml(prof);
  openPrint(`${TIPO_LABEL[reg.tipo]} — ${patientName}`, body);
}

function printProntuario(
  clinic: ClinicHeader,
  patient: PatientRow,
  ficha: Ficha | null,
  registros: RegistroRow[],
  profName: (id: string | null) => string | null,
) {
  const patientName = patient.name?.trim() || patient.phone || "Paciente";
  const contato = [patient.phone, patient.email].filter(Boolean).join(" · ");

  const fichaRows: string[] = [];
  if (ficha) {
    const add = (label: string, v: string) => {
      if (v.trim()) fichaRows.push(`<p class="ficha-row"><strong>${esc(label)}:</strong> ${nl2br(v)}</p>`);
    };
    add("Tipo sanguíneo", ficha.tipo_sanguineo);
    add("Alergias", ficha.alergias);
    add("Condições crônicas", ficha.condicoes_cronicas);
    add("Medicações em uso", ficha.medicacoes_uso);
    add("Observações", ficha.observacoes);
  }

  // ordem cronológica (mais antigo primeiro) para leitura como histórico
  const ordered = [...registros].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const regsHtml = ordered
    .map((r) => {
      const pn = profName(r.professional_id);
      return (
        `<div class="reg"><div class="reg-head">` +
        `<span class="reg-tag">${esc(TIPO_LABEL[r.tipo])}</span>` +
        `${esc(fmtDate(r.created_at))}${pn ? ` · ${esc(pn)}` : ""}` +
        `${r.titulo ? ` · ${esc(r.titulo)}` : ""}` +
        `</div><div class="reg-body">${nl2br(r.conteudo)}</div></div>`
      );
    })
    .join("");

  const body =
    clinicHeaderHtml(clinic) +
    `<div class="doc-title">Prontuário</div>` +
    `<p class="meta"><strong>Paciente:</strong> ${esc(patientName)}</p>` +
    (contato ? `<p class="meta"><strong>Contacto:</strong> ${esc(contato)}</p>` : "") +
    `<p class="meta"><strong>Emitido em:</strong> ${esc(
      new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }),
    )}</p>` +
    (fichaRows.length ? `<div class="section-title">Ficha clínica</div>${fichaRows.join("")}` : "") +
    `<div class="section-title">Evoluções e documentos</div>` +
    (regsHtml || `<p class="ficha-row">Sem registos.</p>`);
  openPrint(`Prontuário — ${patientName}`, body);
}

function docTemplate(tipo: Tipo, patientName: string): string {
  const nome = patientName || "___";
  if (tipo === "atestado") {
    return `Atesto para os devidos fins que o(a) paciente ${nome} esteve sob atendimento nesta data, necessitando de ___ dia(s) de afastamento de suas atividades a partir de ___/___/______.`;
  }
  if (tipo === "declaracao") {
    return `Declaro para os devidos fins que o(a) paciente ${nome} compareceu a esta clínica na data de hoje para atendimento.`;
  }
  return "";
}

export function ProntuarioPanel({ supabase, clinicId }: Props) {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [patientsError, setPatientsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [profs, setProfs] = useState<ProfRow[]>([]);
  const [clinic, setClinic] = useState<ClinicHeader | null>(null);

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
      .select("id, name, specialty")
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

  useEffect(() => {
    let alive = true;
    void supabase
      .from("clinics")
      .select("name, phone, agent_instructions")
      .eq("id", clinicId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return;
        let endereco: string | null = null;
        try {
          const ai = data.agent_instructions;
          const parsed = typeof ai === "string" ? JSON.parse(ai) : ai;
          endereco = (parsed?.endereco as string) || null;
        } catch {
          endereco = null;
        }
        setClinic({ name: data.name ?? "Clínica", phone: data.phone ?? null, endereco });
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
            clinic={clinic}
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
  clinic,
  patient,
  profs,
  tab,
  setTab,
}: {
  supabase: SupabaseClient;
  clinicId: string;
  clinic: ClinicHeader | null;
  patient: PatientRow;
  profs: ProfRow[];
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [printing, setPrinting] = useState(false);

  const profName = useCallback(
    (id: string | null) => (id ? profs.find((p) => p.id === id)?.name ?? null : null),
    [profs],
  );

  useEffect(() => {
    let alive = true;
    void supabase
      .from("appointments")
      .select("id, starts_at, service_name, professional_id, status")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patient.id)
      .order("starts_at", { ascending: false })
      .then(({ data }) => {
        if (alive) setAppointments((data as AppointmentRow[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [supabase, clinicId, patient.id]);

  const handlePrintProntuario = async () => {
    if (!clinic || printing) return;
    setPrinting(true);
    const [fichaRes, regsRes] = await Promise.all([
      supabase
        .from("cs_prontuario_ficha")
        .select("alergias, condicoes_cronicas, medicacoes_uso, tipo_sanguineo, observacoes")
        .eq("clinic_id", clinicId)
        .eq("patient_id", patient.id)
        .maybeSingle(),
      supabase
        .from("cs_prontuario_registros")
        .select("id, tipo, titulo, conteudo, professional_id, appointment_id, created_at")
        .eq("clinic_id", clinicId)
        .eq("patient_id", patient.id)
        .order("created_at", { ascending: true }),
    ]);
    setPrinting(false);
    const fichaData = fichaRes.data
      ? {
          alergias: fichaRes.data.alergias ?? "",
          condicoes_cronicas: fichaRes.data.condicoes_cronicas ?? "",
          medicacoes_uso: fichaRes.data.medicacoes_uso ?? "",
          tipo_sanguineo: fichaRes.data.tipo_sanguineo ?? "",
          observacoes: fichaRes.data.observacoes ?? "",
        }
      : null;
    printProntuario(clinic, patient, fichaData, (regsRes.data as RegistroRow[]) ?? [], profName);
  };

  const tabClass = (t: Tab) =>
    `px-4 py-2.5 text-sm font-semibold transition-colors ${
      tab === t
        ? "text-[var(--primary)] border-b-2 border-[var(--primary)]"
        : "text-[var(--text-muted)] hover:text-[var(--text)] border-b-2 border-transparent"
    }`;

  return (
    <>
      {/* cabeçalho */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-[var(--text)]">
            {patient.name?.trim() || patient.phone || "Sem nome"}
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            {[patient.phone, patient.email].filter(Boolean).join(" · ") || "Sem contacto"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handlePrintProntuario()}
          disabled={!clinic || printing}
          className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] transition-colors hover:bg-[var(--surface-soft)] disabled:opacity-60"
          title="Imprimir / exportar PDF do prontuário completo"
        >
          {printing ? "A preparar…" : "🖨 Imprimir prontuário"}
        </button>
      </div>

      {/* abas */}
      <div className="flex shrink-0 gap-1 border-b border-[var(--border)] px-3">
        <button type="button" className={tabClass("ficha")} onClick={() => setTab("ficha")}>
          Ficha
        </button>
        <button type="button" className={tabClass("evolucoes")} onClick={() => setTab("evolucoes")}>
          Evoluções
        </button>
        <button type="button" className={tabClass("documentos")} onClick={() => setTab("documentos")}>
          Documentos
        </button>
        <button type="button" className={tabClass("anexos")} onClick={() => setTab("anexos")}>
          Anexos
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === "ficha" ? (
          <FichaTab supabase={supabase} clinicId={clinicId} patientId={patient.id} />
        ) : tab === "evolucoes" ? (
          <EvolucoesTab
            supabase={supabase}
            clinicId={clinicId}
            patientId={patient.id}
            profs={profs}
            profName={profName}
            appointments={appointments}
          />
        ) : tab === "documentos" ? (
          <DocumentosTab
            supabase={supabase}
            clinicId={clinicId}
            clinic={clinic}
            patient={patient}
            profs={profs}
            profName={profName}
          />
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
// Aba Evoluções (tipos clínicos: evolução, anamnese, nota) — criar/editar/apagar
// ===========================================================================
function EvolucoesTab({
  supabase,
  clinicId,
  patientId,
  profs,
  profName,
  appointments,
}: {
  supabase: SupabaseClient;
  clinicId: string;
  patientId: string;
  profs: ProfRow[];
  profName: (id: string | null) => string | null;
  appointments: AppointmentRow[];
}) {
  const [rows, setRows] = useState<RegistroRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tipo, setTipo] = useState<Tipo>("evolucao");
  const [titulo, setTitulo] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [profId, setProfId] = useState<string>("");
  const [apptId, setApptId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const apptMap = useMemo(() => {
    const m = new Map<string, AppointmentRow>();
    appointments.forEach((a) => m.set(a.id, a));
    return m;
  }, [appointments]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("cs_prontuario_registros")
      .select("id, tipo, titulo, conteudo, professional_id, appointment_id, created_at")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .in("tipo", CLINICAL_TIPOS)
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
    setApptId("");
    setShowForm(false);
    setEditingId(null);
  };

  const openNew = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (r: RegistroRow) => {
    setEditingId(r.id);
    setTipo(r.tipo);
    setTitulo(r.titulo ?? "");
    setConteudo(r.conteudo);
    setProfId(r.professional_id ?? "");
    setApptId(r.appointment_id ?? "");
    setShowForm(true);
  };

  const save = async () => {
    if (!conteudo.trim()) return;
    setSaving(true);
    setError(null);
    if (editingId) {
      const { error: e } = await supabase
        .from("cs_prontuario_registros")
        .update({
          professional_id: profId || null,
          appointment_id: apptId || null,
          tipo,
          titulo: titulo.trim() || null,
          conteudo: conteudo.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("clinic_id", clinicId)
        .eq("id", editingId);
      setSaving(false);
      if (e) {
        setError(e.message);
        return;
      }
    } else {
      const { data: userData } = await supabase.auth.getUser();
      const { error: e } = await supabase.from("cs_prontuario_registros").insert({
        clinic_id: clinicId,
        patient_id: patientId,
        professional_id: profId || null,
        appointment_id: apptId || null,
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
          onClick={openNew}
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
                onChange={(e) => setTipo(e.target.value as Tipo)}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
              >
                <option value="evolucao">Evolução</option>
                <option value="anamnese">Anamnese</option>
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Consulta (opcional)</label>
            <select
              value={apptId}
              onChange={(e) => setApptId(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
            >
              <option value="">— Não vincular —</option>
              {appointments.map((a) => (
                <option key={a.id} value={a.id}>
                  {fmtApptLabel(a)}
                </option>
              ))}
            </select>
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
              {saving ? "A guardar…" : editingId ? "Guardar alterações" : "Guardar"}
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
          {rows.map((r) => {
            const appt = r.appointment_id ? apptMap.get(r.appointment_id) : null;
            return (
              <li key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase ${TIPO_COLOR[r.tipo]}`}>
                    {TIPO_LABEL[r.tipo]}
                  </span>
                  {r.titulo ? <span className="text-sm font-semibold text-[var(--text)]">{r.titulo}</span> : null}
                  <span className="ml-auto text-xs text-[var(--text-muted)]">{fmtDate(r.created_at)}</span>
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="text-[var(--text-muted)] transition-colors hover:text-[var(--primary)]"
                    title="Editar"
                    aria-label="Editar evolução"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
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
                <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-[var(--text-muted)]">
                  {profName(r.professional_id) ? <span>— {profName(r.professional_id)}</span> : null}
                  {appt ? <span>📅 Consulta: {fmtApptLabel(appt)}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ===========================================================================
// Aba Documentos (atestado / receita / declaração) — criar/apagar/imprimir
// ===========================================================================
function DocumentosTab({
  supabase,
  clinicId,
  clinic,
  patient,
  profs,
  profName,
}: {
  supabase: SupabaseClient;
  clinicId: string;
  clinic: ClinicHeader | null;
  patient: PatientRow;
  profs: ProfRow[];
  profName: (id: string | null) => string | null;
}) {
  const [rows, setRows] = useState<RegistroRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("atestado");
  const [titulo, setTitulo] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [profId, setProfId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const patientName = patient.name?.trim() || patient.phone || "";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("cs_prontuario_registros")
      .select("id, tipo, titulo, conteudo, professional_id, appointment_id, created_at")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patient.id)
      .in("tipo", DOC_TIPOS)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    setRows((data as RegistroRow[]) ?? []);
  }, [supabase, clinicId, patient.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setTipo("atestado");
    setTitulo("");
    setConteudo("");
    setProfId("");
    setShowForm(false);
  };

  const changeTipo = (t: Tipo) => {
    setTipo(t);
    // pré-preenche modelo se o conteúdo estiver vazio
    setConteudo((c) => (c.trim() ? c : docTemplate(t, patientName)));
  };

  const openNew = () => {
    resetForm();
    setConteudo(docTemplate("atestado", patientName));
    setShowForm(true);
  };

  const save = async () => {
    if (!conteudo.trim()) return;
    setSaving(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const { error: e } = await supabase.from("cs_prontuario_registros").insert({
      clinic_id: clinicId,
      patient_id: patient.id,
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

  const print = (r: RegistroRow) => {
    if (!clinic) return;
    const prof = r.professional_id ? profs.find((p) => p.id === r.professional_id) ?? null : null;
    printDocumento(clinic, patient, r, prof);
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {!showForm ? (
        <button
          type="button"
          onClick={openNew}
          className="self-start rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-95"
        >
          + Novo documento
        </button>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tipo</label>
              <select
                value={tipo}
                onChange={(e) => changeTipo(e.target.value as Tipo)}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)]"
              >
                <option value="atestado">Atestado</option>
                <option value="receita">Receita</option>
                <option value="declaracao">Declaração</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Profissional (assinatura)
              </label>
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
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Assunto (opcional)</label>
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
              rows={6}
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
              {saving ? "A guardar…" : "Guardar documento"}
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
        <p className="text-sm text-[var(--text-muted)]">A carregar documentos…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Nenhum documento emitido ainda.</p>
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
                  onClick={() => print(r)}
                  disabled={!clinic}
                  className="text-[var(--text-muted)] transition-colors hover:text-[var(--primary)] disabled:opacity-50"
                  title="Imprimir / PDF"
                  aria-label="Imprimir documento"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => void remove(r.id)}
                  className="text-[var(--text-muted)] transition-colors hover:text-red-500"
                  title="Apagar"
                  aria-label="Apagar documento"
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
