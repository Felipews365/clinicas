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
  const [linkLocalizacao, setLinkLocalizacao] = useState("");
  const [aceitaConvenio, setAceitaConvenio] = useState<boolean | null>(null);
  const [lembreteMinutos, setLembreteMinutos] = useState<number | null>(null);
  const [lembreteMensagem, setLembreteMensagem] = useState("");
  const [lembreteSugestoesInteligentes, setLembreteSugestoesInteligentes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (open) { setActiveTab("dados"); setDirty(false); }
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
          setLinkLocalizacao(typeof parsed.link_localizacao === "string" ? parsed.link_localizacao : "");
          setAceitaConvenio(typeof parsed.aceita_convenio === "boolean" ? parsed.aceita_convenio : null);
          setLembreteMinutos(parsed.lembrete_antecedencia_minutos ?? null);
          setLembreteMensagem(parsed.lembrete_mensagem ?? "");
          setLembreteSugestoesInteligentes(
            typeof parsed.lembrete_sugestoes_inteligentes === "string"
              ? parsed.lembrete_sugestoes_inteligentes
              : ""
          );
        } catch {
          setQuemSomos("");
          setEnderecoClinica("");
          setLinkLocalizacao("");
          setAceitaConvenio(null);
          setLembreteMinutos(null);
          setLembreteMensagem("");
          setLembreteSugestoesInteligentes("");
        }
        setDirty(false);
      });
  }, [open, supabase, clinicId]);

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
      link_localizacao: linkLocalizacao.trim() || null,
      aceita_convenio: aceitaConvenio,
      lembrete_antecedencia_minutos: lembreteMinutos,
      lembrete_mensagem: lembreteMensagem || null,
      lembrete_sugestoes_inteligentes: lembreteSugestoesInteligentes.trim() || null,
    };
    const updates: Record<string, unknown> = { agent_instructions: JSON.stringify(merged) };
    if (clinicName.trim() && clinicName.trim() !== (typeof current?.name === "string" ? current.name : "")) {
      updates.name = clinicName.trim();
    }
    const { error: e } = await supabase.from("clinics").update(updates).eq("id", clinicId);
    setSaving(false);
    if (e) { setError(e.message); return; }
    setSaved(true);
    setDirty(false);
    setTimeout(() => setSaved(false), 2500);
  }, [supabase, clinicId, clinicName, quemSomos, enderecoClinica, linkLocalizacao, aceitaConvenio, lembreteMinutos, lembreteMensagem, lembreteSugestoesInteligentes]);

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
                  <label htmlFor="cp-link-maps" className="text-sm font-semibold text-[var(--text)]">
                    Link do Google Maps
                  </label>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Quando o paciente pedir o endereço, o agente enviará este link.
                  </p>
                  <div className="mt-3 rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] px-3 py-2.5">
                    <p className="text-xs font-semibold text-[var(--text)] mb-1.5">Como obter o link</p>
                    <ol className="space-y-1 text-[11px] text-[var(--text-muted)] list-none">
                      <li className="flex gap-1.5"><span className="font-bold shrink-0">1.</span><span>Abra o <strong>Google Maps</strong>.</span></li>
                      <li className="flex gap-1.5"><span className="font-bold shrink-0">2.</span><span>Pesquise o nome ou endereço da sua clínica.</span></li>
                      <li className="flex gap-1.5"><span className="font-bold shrink-0">3.</span><span>Clique em <strong>Compartilhar</strong> → <strong>Copiar link</strong>.</span></li>
                      <li className="flex gap-1.5"><span className="font-bold shrink-0">4.</span><span>Cole abaixo (começa com <code className="rounded bg-[var(--border)] px-1">maps.app.goo.gl</code>).</span></li>
                    </ol>
                  </div>
                  <input
                    id="cp-link-maps"
                    type="url"
                    value={linkLocalizacao}
                    onChange={(e) => { setLinkLocalizacao(e.target.value); mark(); }}
                    placeholder="https://maps.app.goo.gl/..."
                    className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--text-muted)] outline-none ring-[var(--primary)] focus:ring-2"
                  />
                  {linkLocalizacao.trim() && (
                    <a
                      href={linkLocalizacao.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs font-medium text-[var(--primary)] transition-colors hover:bg-[var(--surface)]"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
                        <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Zm6.75-3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V3.81l-6.22 6.22a.75.75 0 1 1-1.06-1.06L14.69 2.75H11a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
                      </svg>
                      Verificar no Google Maps
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
                  </div>
                )}

                <div>
                  <p className="text-sm font-semibold text-[var(--text)]">Lembretes inteligentes</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Instruções para o agente <strong className="font-medium">sugerir</strong> consultas de manutenção ou retorno
                    com base no histórico do paciente.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="self-center text-xs text-[var(--text-muted)]">Modelo:</span>
                    <button
                      type="button"
                      onClick={() => { setLembreteSugestoesInteligentes(LEMBRETES_INTELIGENTES_PADRAO); mark(); }}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1 text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
                    >
                      Padrão
                    </button>
                    {lembreteSugestoesInteligentes.trim() ? (
                      <button
                        type="button"
                        onClick={() => { setLembreteSugestoesInteligentes(""); mark(); }}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface)]"
                      >
                        Limpar
                      </button>
                    ) : null}
                  </div>
                  <textarea
                    value={lembreteSugestoesInteligentes}
                    onChange={(e) => { setLembreteSugestoesInteligentes(e.target.value); mark(); }}
                    placeholder="Ex.: sugerir limpeza periódica a cada 6 meses, retorno pós-tratamento…"
                    rows={4}
                    className="mt-2 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none ring-[var(--primary)] focus:ring-2"
                    spellCheck
                  />
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
              className={`flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm transition-all disabled:opacity-60 ${
                saved
                  ? "bg-emerald-700 text-white"
                  : "bg-[var(--primary)] text-white hover:-translate-y-px hover:shadow-md"
              }`}
            >
              {saving ? "A guardar…" : saved ? "✓ Guardado" : "Guardar"}
            </button>
          </div>
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
