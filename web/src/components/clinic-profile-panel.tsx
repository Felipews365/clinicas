"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ClinicAgendaHoursModal } from "@/components/clinic-agenda-hours-modal";
import { ProceduresSectionInline } from "@/components/agent-config-modal";

type Tab = "dados" | "localizacao" | "convenios" | "procedimentos" | "horarios" | "lembretes";

const TABS: { id: Tab; emoji: string; label: string }[] = [
  { id: "dados", emoji: "🏥", label: "Dados gerais" },
  { id: "localizacao", emoji: "📍", label: "Localização" },
  { id: "convenios", emoji: "💳", label: "Convênios" },
  { id: "procedimentos", emoji: "📋", label: "Procedimentos" },
  { id: "horarios", emoji: "📅", label: "Horários" },
  { id: "lembretes", emoji: "⏰", label: "Lembretes" },
];

const LEMBRETE_MENSAGEM_PADRAO =
  "Olá, {{nome}}! Lembramos que você tem uma consulta agendada para *{{data}}* às *{{hora}}*. Não se atrase! 😊 Caso precise remarcar, é só nos avisar.";

const LEMBRETES_INTELIGENTES_PADRAO =
  "Se o histórico mostrar que o paciente fez limpeza há mais de 6 meses, sugira agendar a próxima manutenção.\nSe o paciente usa aparelho ortodôntico e o último registro de manutenção for há mais de 35 dias, sugira agendar.";

export function ClinicProfilePanel({
  open,
  onClose,
  supabase,
  clinicId,
  presentation = "modal",
}: {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient | null;
  clinicId: string;
  presentation?: "modal" | "panel";
}) {
  const [activeTab, setActiveTab] = useState<Tab>("dados");
  const [clinicName, setClinicName] = useState("");
  const [quemSomos, setQuemSomos] = useState("");
  const [enderecoClinica, setEnderecoClinica] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [aceitaConvenio, setAceitaConvenio] = useState<boolean | null>(null);
  const [lembreteMinutos, setLembreteMinutos] = useState<number | null>(null);
  const [lembreteMensagem, setLembreteMensagem] = useState("");
  const [lembreteSugestoesInteligentes, setLembreteSugestoesInteligentes] = useState("");
  const [lembreteSaudadesMeses, setLembreteSaudadesMeses] = useState<string>("");
  const [procedures, setProcedures] = useState<Array<{ id: string; name: string; reminder_months: number | null }>>([]);
  const [proceduresLoading, setProceduresLoading] = useState(false);
  const [addProcId, setAddProcId] = useState<string>("");
  const [addProcMonths, setAddProcMonths] = useState<string>("");
  const [procBusy, setProcBusy] = useState<string | null>(null);
  const [procError, setProcError] = useState<string | null>(null);
  const [pendingProcChanges, setPendingProcChanges] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (open) { setActiveTab("dados"); setDirty(false); setPendingProcChanges({}); }
  }, [open]);

  useEffect(() => {
    if (!open || !supabase || !clinicId) return;
    setLoading(true);
    setError(null);
    supabase
      .from("clinics")
      .select("name, agent_instructions")
      .eq("id", clinicId)
      .single()
      .then(({ data, error: e }) => {
        setLoading(false);
        if (e) { setError(e.message); return; }
        setClinicName(typeof data?.name === "string" ? data.name : "");
        try {
          const parsed = data?.agent_instructions ? JSON.parse(data.agent_instructions as string) : {};
          setQuemSomos(typeof parsed.quem_somos === "string" ? parsed.quem_somos : "");
          setEnderecoClinica(typeof parsed.endereco === "string" ? parsed.endereco : "");
          setLatitude(parsed.latitude != null ? String(parsed.latitude) : "");
          setLongitude(parsed.longitude != null ? String(parsed.longitude) : "");
          setAceitaConvenio(typeof parsed.aceita_convenio === "boolean" ? parsed.aceita_convenio : null);
          setLembreteMinutos(parsed.lembrete_antecedencia_minutos ?? null);
          setLembreteMensagem(parsed.lembrete_mensagem ?? "");
          setLembreteSugestoesInteligentes(
            typeof parsed.lembrete_sugestoes_inteligentes === "string"
              ? parsed.lembrete_sugestoes_inteligentes
              : ""
          );
          setLembreteSaudadesMeses(
            parsed.lembrete_saudades_meses != null && parsed.lembrete_saudades_meses !== ""
              ? String(parsed.lembrete_saudades_meses)
              : ""
          );
        } catch {
          setQuemSomos("");
          setEnderecoClinica("");
          setLatitude("");
          setLongitude("");
          setAceitaConvenio(null);
          setLembreteMinutos(null);
          setLembreteMensagem("");
          setLembreteSugestoesInteligentes("");
          setLembreteSaudadesMeses("");
        }
        setDirty(false);
      });
  }, [open, supabase, clinicId]);

  const loadProcedures = useCallback(async () => {
    if (!supabase) return;
    setProceduresLoading(true);
    const { data, error: e } = await supabase
      .from("clinic_procedures")
      .select("id, name, reminder_months")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("name", { ascending: true });
    setProceduresLoading(false);
    if (e) { setProcError(e.message); return; }
    setProcedures((data ?? []) as Array<{ id: string; name: string; reminder_months: number | null }>);
    setProcError(null);
  }, [supabase, clinicId]);

  useEffect(() => {
    if (open && activeTab === "lembretes") void loadProcedures();
  }, [open, activeTab, loadProcedures]);

  const addProcedureRule = useCallback(() => {
    if (!addProcId) return;
    const n = parseInt(addProcMonths.trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > 120) {
      setProcError("Tempo em meses inválido (1–120).");
      return;
    }
    setProcedures((prev) => prev.map((p) => (p.id === addProcId ? { ...p, reminder_months: n } : p)));
    setPendingProcChanges((prev) => ({ ...prev, [addProcId]: n }));
    setAddProcId(""); setAddProcMonths(""); setProcError(null);
    setDirty(true); setSaved(false);
  }, [addProcId, addProcMonths]);

  const removeProcedureRule = useCallback((id: string) => {
    setProcedures((prev) => prev.map((p) => (p.id === id ? { ...p, reminder_months: null } : p)));
    setPendingProcChanges((prev) => ({ ...prev, [id]: null }));
    setProcError(null);
    setDirty(true); setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!supabase) return;
    setSaving(true);
    setError(null);
    // Read-modify-write: preserves agent behavior fields
    const { data: current } = await supabase
      .from("clinics")
      .select("agent_instructions, name")
      .eq("id", clinicId)
      .single();
    let existing: Record<string, unknown> = {};
    try {
      existing = current?.agent_instructions ? JSON.parse(current.agent_instructions as string) : {};
    } catch { /* noop */ }
    const merged = {
      ...existing,
      quem_somos: quemSomos.trim() || null,
      endereco: enderecoClinica.trim() || null,
      link_localizacao: null,
      latitude: (() => { const n = parseFloat(latitude.trim().replace(",", ".")); return Number.isFinite(n) ? n : null; })(),
      longitude: (() => { const n = parseFloat(longitude.trim().replace(",", ".")); return Number.isFinite(n) ? n : null; })(),
      aceita_convenio: aceitaConvenio,
      lembrete_antecedencia_minutos: lembreteMinutos,
      lembrete_mensagem: lembreteMensagem || null,
      lembrete_sugestoes_inteligentes: lembreteSugestoesInteligentes.trim() || null,
      lembrete_saudades_meses: (() => {
        const t = lembreteSaudadesMeses.trim();
        if (!t) return null;
        const n = parseInt(t, 10);
        return Number.isFinite(n) && n >= 1 && n <= 120 ? n : null;
      })(),
    };
    const updates: Record<string, unknown> = { agent_instructions: JSON.stringify(merged) };
    if (clinicName.trim() && clinicName.trim() !== (typeof current?.name === "string" ? current.name : "")) {
      updates.name = clinicName.trim();
    }
    const { error: e } = await supabase.from("clinics").update(updates).eq("id", clinicId);
    if (e) { setSaving(false); setError(e.message); return; }
    const procEntries = Object.entries(pendingProcChanges);
    for (const [id, months] of procEntries) {
      const { error: pe } = await supabase
        .from("clinic_procedures")
        .update({ reminder_months: months })
        .eq("id", id)
        .eq("clinic_id", clinicId);
      if (pe) { setSaving(false); setError(pe.message); return; }
    }
    setPendingProcChanges({});
    setSaving(false);
    setSaved(true);
    setDirty(false);
    setTimeout(() => setSaved(false), 2500);
  }, [supabase, clinicId, clinicName, quemSomos, enderecoClinica, latitude, longitude, aceitaConvenio, lembreteMinutos, lembreteMensagem, lembreteSugestoesInteligentes, lembreteSaudadesMeses, pendingProcChanges]);

  function mark() { setDirty(true); setSaved(false); }

  if (!open) return null;
  const isPanel = presentation === "panel";

  const tabsWithSave: Tab[] = ["dados", "localizacao", "convenios", "lembretes"];
  const showSave = tabsWithSave.includes(activeTab);

  const shell = (
    <div
      role={isPanel ? "region" : "dialog"}
      aria-modal={isPanel ? undefined : true}
      aria-label="Clínica / Perfil"
      className={
        isPanel
          ? "relative flex min-h-0 w-full min-w-0 max-w-none flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm"
          : "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_-8px_48px_-8px_rgba(44,40,37,0.25)] sm:inset-0 sm:m-auto sm:max-h-[90dvh] sm:w-full sm:max-w-2xl sm:rounded-3xl"
      }
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--text)]">
            Clínica / Perfil
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Dados da clínica, localização, convênios, procedimentos, horários e lembretes.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="shrink-0 overflow-x-auto border-b border-[var(--border)] px-4">
        <div className="flex gap-1 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === t.id
                  ? "bg-[var(--primary)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
              }`}
            >
              <span>{t.emoji}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <span className="text-sm text-[var(--text-muted)]">A carregar…</span>
          </div>
        ) : (
          <>
            {/* Dados gerais */}
            {activeTab === "dados" && (
              <div className="space-y-5">
                <div>
                  <label htmlFor="cp-clinic-name" className="text-sm font-semibold text-[var(--text)]">
                    Nome da clínica
                  </label>
                  <input
                    id="cp-clinic-name"
                    type="text"
                    value={clinicName}
                    onChange={(e) => { setClinicName(e.target.value); mark(); }}
                    className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
                    placeholder="Ex: Clínica Saúde & Bem-estar"
                  />
                </div>
                <div>
                  <label htmlFor="cp-quem-somos" className="text-sm font-semibold text-[var(--text)]">
                    Quem somos
                  </label>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Breve apresentação da clínica. O agente usará este texto ao se apresentar.{" "}
                    Marcadores: <code className="rounded bg-[var(--surface-soft)] px-1">{"{{quem_somos}}"}</code>.
                  </p>
                  <textarea
                    id="cp-quem-somos"
                    value={quemSomos}
                    onChange={(e) => { setQuemSomos(e.target.value); mark(); }}
                    placeholder="Ex.: Clínica familiar com 15 anos de experiência, equipa multidisciplinar…"
                    rows={4}
                    className="mt-1.5 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
                    spellCheck
                  />
                </div>
              </div>
            )}

            {/* Localização */}
            {activeTab === "localizacao" && (
              <div className="space-y-5">
                <div>
                  <label htmlFor="cp-endereco" className="text-sm font-semibold text-[var(--text)]">
                    Endereço
                  </label>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Morada para o agente indicar ao paciente.{" "}
                    Marcadores: <code className="rounded bg-[var(--surface-soft)] px-1">{"{{endereco}}"}</code>.
                  </p>
                  <textarea
                    id="cp-endereco"
                    value={enderecoClinica}
                    onChange={(e) => { setEnderecoClinica(e.target.value); mark(); }}
                    placeholder="Ex.: Rua das Flores, 123 — Centro — CEP 01234-567"
                    rows={3}
                    className="mt-1.5 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
                    spellCheck
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--text)]">
                    Coordenadas da clínica
                  </label>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Quando preenchidas, o agente envia um <strong>card de localização</strong> nativo do WhatsApp (em vez de só o link) sempre que o cliente perguntar pelo endereço.
                  </p>
                  <div className="mt-3 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] px-3 py-2.5">
                    <p className="text-xs font-semibold text-[var(--text)] mb-1.5">Como obter as coordenadas</p>
                    <ol className="space-y-1 text-[11px] text-[var(--text-muted)] list-none">
                      <li className="flex gap-1.5"><span className="font-bold shrink-0">1.</span><span>Abra o <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--primary)] underline hover:opacity-80">Google Maps</a> no computador.</span></li>
                      <li className="flex gap-1.5"><span className="font-bold shrink-0">2.</span><span>Clique com o <strong>botão direito</strong> no ponto exacto da clínica.</span></li>
                      <li className="flex gap-1.5"><span className="font-bold shrink-0">3.</span><span>Clique nas coordenadas que aparecem no topo (ex.: <code className="rounded bg-[var(--border)] px-1">-8.0476, -34.8770</code>) — são copiadas.</span></li>
                      <li className="flex gap-1.5"><span className="font-bold shrink-0">4.</span><span>Cole abaixo: o 1º número é latitude, o 2º é longitude.</span></li>
                    </ol>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="cp-lat" className="text-xs font-medium text-[var(--text-muted)]">Latitude</label>
                      <input
                        id="cp-lat"
                        type="text"
                        inputMode="decimal"
                        value={latitude}
                        onChange={(e) => { setLatitude(e.target.value); mark(); }}
                        placeholder="-8.0476"
                        className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--text-muted)] outline-none ring-[var(--primary)] focus:ring-2"
                      />
                    </div>
                    <div>
                      <label htmlFor="cp-lng" className="text-xs font-medium text-[var(--text-muted)]">Longitude</label>
                      <input
                        id="cp-lng"
                        type="text"
                        inputMode="decimal"
                        value={longitude}
                        onChange={(e) => { setLongitude(e.target.value); mark(); }}
                        placeholder="-34.8770"
                        className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--text-muted)] outline-none ring-[var(--primary)] focus:ring-2"
                      />
                    </div>
                  </div>
                  {latitude.trim() && longitude.trim() && (
                    <a
                      href={`https://www.google.com/maps?q=${encodeURIComponent(latitude.trim())},${encodeURIComponent(longitude.trim())}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-medium text-[var(--primary)] transition-colors hover:bg-[var(--surface)]"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
                        <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Zm6.75-3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V3.81l-6.22 6.22a.75.75 0 1 1-1.06-1.06L14.69 2.75H11a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                      </svg>
                      Conferir ponto exacto no Maps
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Convênios */}
            {activeTab === "convenios" && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">Aceita convênio / plano de saúde?</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    O agente informará o paciente automaticamente quando perguntado.
                  </p>
                  <div className="mt-3 flex gap-2">
                    {([
                      { value: null, label: "Não definido" },
                      { value: true, label: "✅ Sim, aceita" },
                      { value: false, label: "❌ Não aceita" },
                    ] as { value: boolean | null; label: string }[]).map((opt) => (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => { setAceitaConvenio(opt.value); mark(); }}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          aceitaConvenio === opt.value
                            ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                            : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text)] hover:border-[var(--primary)]/50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Procedimentos */}
            {activeTab === "procedimentos" && supabase && (
              <ProceduresSectionInline
                supabase={supabase}
                clinicId={clinicId}
                modalOpen={open}
              />
            )}

            {/* Horários */}
            {activeTab === "horarios" && supabase && (
              <div className="-mx-6 -my-5">
                <ClinicAgendaHoursModal
                  open={true}
                  onClose={onClose}
                  supabase={supabase}
                  clinicId={clinicId}
                  presentation="panel"
                  onSaved={() => {}}
                />
              </div>
            )}

            {/* Lembretes */}
            {activeTab === "lembretes" && (
              <div className="space-y-5">
                <div>
                  <label htmlFor="cp-lembrete-antecedencia" className="text-sm font-semibold text-[var(--text)]">
                    Enviar lembrete quanto tempo antes
                  </label>
                  <select
                    id="cp-lembrete-antecedencia"
                    value={lembreteMinutos ?? ""}
                    onChange={(e) => { setLembreteMinutos(e.target.value ? Number(e.target.value) : null); mark(); }}
                    className="mt-1.5 w-full max-w-[16rem] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
                  >
                    <option value="">Não enviar</option>
                    <option value="30">30 min antes</option>
                    <option value="60">1 hora antes</option>
                    <option value="120">2 horas antes</option>
                    <option value="180">3 horas antes</option>
                    <option value="360">6 horas antes</option>
                    <option value="720">12 horas antes</option>
                    <option value="1440">24 horas antes</option>
                    <option value="2880">48 horas antes</option>
                  </select>
                </div>

                {lembreteMinutos != null && (
                  <div>
                    <label className="text-sm font-semibold text-[var(--text)]">Mensagem do lembrete</label>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      Use <code className="rounded bg-[var(--surface-soft)] px-1">{"{{nome}}"}</code>,{" "}
                      <code className="rounded bg-[var(--surface-soft)] px-1">{"{{data}}"}</code> e{" "}
                      <code className="rounded bg-[var(--surface-soft)] px-1">{"{{hora}}"}</code> como variáveis.
                    </p>
                    <textarea
                      value={lembreteMensagem || LEMBRETE_MENSAGEM_PADRAO}
                      onChange={(e) => {
                        const v = e.target.value;
                        setLembreteMensagem(v === LEMBRETE_MENSAGEM_PADRAO ? "" : v);
                        mark();
                      }}
                      rows={4}
                      className="mt-1.5 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
                      spellCheck={false}
                    />
                    {lembreteMensagem && lembreteMensagem !== LEMBRETE_MENSAGEM_PADRAO && (
                      <button
                        type="button"
                        onClick={() => { setLembreteMensagem(""); mark(); }}
                        className="mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)]"
                      >
                        Restaurar mensagem padrão
                      </button>
                    )}

                    {/* Pré-visualização estilo WhatsApp */}
                    <div className="mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        Pré-visualização (como chega ao paciente)
                      </p>
                      <div className="mt-2 rounded-2xl border border-[var(--border)] bg-[#0b141a] p-4">
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[#005c4b] px-3 py-2 text-sm text-white shadow-sm">
                            <p className="whitespace-pre-wrap leading-snug">
                              {(lembreteMensagem || LEMBRETE_MENSAGEM_PADRAO)
                                .replace(/\{\{\s*nome\s*\}\}/gi, "João")
                                .replace(/\{\{\s*data\s*\}\}/gi, "15/06/2026")
                                .replace(/\{\{\s*hora\s*\}\}/gi, "14:30")
                                .split(/(\*[^*]+\*)/g)
                                .map((chunk, i) =>
                                  /^\*[^*]+\*$/.test(chunk) ? (
                                    <strong key={i} className="font-semibold">{chunk.slice(1, -1)}</strong>
                                  ) : (
                                    <span key={i}>{chunk}</span>
                                  )
                                )}
                            </p>
                            <p className="mt-1 text-right text-[10px] text-white/60">14:00 ✓✓</p>
                          </div>
                        </div>
                        <p className="mt-2 text-[10px] text-white/40">
                          Exemplo com nome=João, data=15/06/2026, hora=14:30
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <p className="text-sm font-semibold text-[var(--text)]">⏰ Lembretes por procedimento</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Adicione procedimentos e o tempo após o qual o agente lembra o paciente. A mensagem cita o nome do procedimento
                    (ex.: «sua última limpeza foi em outubro de 2025»).
                  </p>

                  {/* lista das regras já configuradas */}
                  <div className="mt-3 space-y-1.5">
                    {proceduresLoading ? (
                      <p className="text-xs text-[var(--text-muted)]">A carregar…</p>
                    ) : procedures.filter((p) => p.reminder_months != null).length === 0 ? (
                      <p className="text-xs italic text-[var(--text-muted)]">Nenhuma regra por procedimento ainda.</p>
                    ) : (
                      procedures.filter((p) => p.reminder_months != null).map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
                          <span className="flex-1 truncate text-[var(--text)]">
                            <strong className="font-semibold">{p.name}</strong>
                            <span className="ml-2 text-[var(--text-muted)]">→ lembra após</span>
                            <span className="ml-1 font-semibold">{p.reminder_months} meses</span>
                          </span>
                          <button
                            type="button"
                            disabled={procBusy === p.id}
                            onClick={() => void removeProcedureRule(p.id)}
                            className="shrink-0 rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                          >
                            Remover
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* form: adicionar nova regra */}
                  {procedures.filter((p) => p.reminder_months == null).length > 0 && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-3">
                      <label className="flex-1 min-w-[10rem] text-xs font-medium text-[var(--text)]">
                        Procedimento
                        <select
                          value={addProcId}
                          onChange={(e) => setAddProcId(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
                        >
                          <option value="">— escolha um procedimento —</option>
                          {procedures.filter((p) => p.reminder_months == null).map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="w-[8rem] text-xs font-medium text-[var(--text)]">
                        Lembrar após (meses)
                        <input
                          type="number"
                          min={1}
                          max={120}
                          placeholder="ex.: 6"
                          value={addProcMonths}
                          onChange={(e) => setAddProcMonths(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!addProcId || !addProcMonths || procBusy != null}
                        onClick={() => void addProcedureRule()}
                        className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
                      >
                        + Adicionar
                      </button>
                    </div>
                  )}
                  {procedures.length === 0 && !proceduresLoading && (
                    <p className="mt-2 text-xs italic text-[var(--text-muted)]">
                      Nenhum procedimento cadastrado nesta clínica. Vá à aba <strong>Procedimentos</strong> para criar.
                    </p>
                  )}
                  {procError && (
                    <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-800">{procError}</p>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--text)]">💌 Lembrete de saudades <span className="ml-1 text-[10px] font-normal uppercase text-[var(--text-muted)]">(opcional, fallback)</span></p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        Rede de segurança para pacientes que nenhum lembrete por procedimento alcançou. A mensagem é genérica
                        («já faz X meses desde sua última visita, está precisando de algo?») e <strong>só dispara se nenhuma regra
                        acima activou</strong>.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={lembreteSaudadesMeses.trim() !== ""}
                      onClick={() => {
                        if (lembreteSaudadesMeses.trim() !== "") {
                          setLembreteSaudadesMeses("");
                        } else {
                          setLembreteSaudadesMeses("8");
                        }
                        mark();
                      }}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                        lembreteSaudadesMeses.trim() !== "" ? "bg-emerald-600" : "bg-zinc-400"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          lembreteSaudadesMeses.trim() !== "" ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                  {lembreteSaudadesMeses.trim() === "" ? (
                    <p className="mt-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
                      Desligado. Active o toggle ↑ para usar este lembrete genérico como rede de segurança.
                    </p>
                  ) : (
                    <>
                      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                        <p className="font-semibold text-[var(--text)]">Por que vale a pena deixar ligado:</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          <li>Cobre <strong>procedimentos novos</strong> que ainda não tens regra definida.</li>
                          <li>Recupera pacientes que fizeram um <strong>procedimento único</strong> (extração, canal) que não precisa de lembrete específico — mas mesmo assim sumiram.</li>
                          <li>Nunca duplica: se a regra por procedimento já activou, este não envia.</li>
                        </ul>
                      </div>
                      <label className="mt-3 block text-xs font-semibold text-[var(--text)]">
                        Lembrar após X meses sem visita
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={lembreteSaudadesMeses}
                          onChange={(e) => { setLembreteSaudadesMeses(e.target.value); mark(); }}
                          className="mt-1 w-full max-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
                        />
                      </label>
                    </>
                  )}
                </div>

              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {showSave && (
        <div className="shrink-0 border-t border-[var(--border)] px-6 py-4">
          {error && (
            <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--text-muted)]">
              {dirty ? "Há alterações não guardadas." : "Sem alterações pendentes."}
            </p>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading || !dirty}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm transition-all disabled:opacity-60 disabled:hover:bg-[var(--primary)] ${
                saved
                  ? "bg-emerald-700 text-white hover:bg-emerald-800"
                  : "bg-[var(--primary)] text-white hover:-translate-y-px hover:bg-emerald-600 hover:shadow-md"
              }`}
            >
              {saving ? "A salvar…" : saved ? "✓ Salvo" : "Salvar"}
            </button>
          </div>
        </div>
      )}

      {/* Toast de confirmação */}
      {saved && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg ring-1 ring-emerald-500/30"
        >
          <span className="inline-flex items-center gap-2">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.55a1 1 0 0 1-1.42.003l-3.5-3.5a1 1 0 1 1 1.414-1.414l2.79 2.79 6.795-6.838a1 1 0 0 1 1.415-.006Z" clipRule="evenodd" />
            </svg>
            Alterações salvas com sucesso
          </span>
        </div>
      )}
    </div>
  );

  if (isPanel) {
    return (
      <div className="w-full min-w-0 pb-2" role="region" aria-label="Clínica / Perfil">
        {shell}
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#1c1917]/45 backdrop-blur-[3px]" onClick={onClose} aria-hidden />
      {shell}
    </>
  );
}
