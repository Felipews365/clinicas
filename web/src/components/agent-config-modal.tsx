"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── templates ────────────────────────────────────────────────────────────────

const TEMPLATES: { label: string; emoji: string; content: string }[] = [
  {
    label: "Odontologia",
    emoji: "🦷",
    content: `## ESPECIALIDADE: ODONTOLOGIA

### Triagem de Urgências
Classifique sempre antes de agendar:
- EMERGÊNCIA (atender hoje): dor intensa e contínua, trauma com perda de dente, sangramento que não para, inchaço severo no rosto, abscesso visível
- URGENTE (próximos 2 dias): dor moderada, bracket solto que machuca, coroa solta
- ROTINA: limpeza, consulta de avaliação, manutenção de aparelho

### Linguagem Tranquilizadora
✅ Use: "remover o dente" em vez de "arrancar"
✅ Use: "desconforto" em vez de "dor"
✅ Use: "tratamento de canal" em vez de "desvitalização"
✅ Use: "dormência local" em vez de "anestesia"
❌ Evite: palavras que causam ansiedade ("doer", "perfurar", "arrancar")

### Tipos de Procedimento
- Primeira consulta / avaliação
- Limpeza / profilaxia (~40 min)
- Restaurações / obturações
- Tratamento de canal
- Extrações
- Clareamento
- Ortodontia (manutenção de aparelho — a cada 30 dias)
- Implantes / próteses

### Orientações Pós-Procedimento
Após extração: compressa fria 20 min a cada 2h (primeiras 24h), comida morna/fria, sem álcool ou cigarro.
Após canal: tomar medicação conforme prescrito, evitar mastigar no lado tratado.
Aparelho ortodôntico: ligar imediatamente se bracket soltar ou fio machucar.

### Transferir para Humano
- Dor 10/10 ou trauma com dente quebrado/perdido
- Criança com menos de 3 anos
- Orçamento complexo (tratamento completo)
- Negociação de valores ou formas de pagamento
- Reclamação sobre atendimento anterior`,
  },
  {
    label: "Clínica Geral",
    emoji: "🩺",
    content: `## ESPECIALIDADE: CLÍNICA GERAL

### Triagem de Urgências
- EMERGÊNCIA: dor no peito, dificuldade respiratória grave, desmaio, sangramento intenso
- URGENTE: febre alta (>39°C), dor forte sem melhora, vômitos persistentes
- ROTINA: check-up, renovação de receitas, resultados de exames, consulta preventiva

### Tipos de Consulta
- Check-up / consulta preventiva
- Renovação de receitas médicas
- Avaliação de resultados de exames
- Consulta por sintoma específico
- Atestados e relatórios médicos

### Orientações Gerais
Lembre sempre que o agente NÃO faz diagnóstico médico.
Para sintomas graves, oriente a procurar pronto-socorro imediatamente.
Para consultas de rotina, informe a necessidade de chegar em jejum se solicitado pelo médico.

### Transferir para Humano
- Descrição de sintomas graves ou urgentes
- Pedido de diagnóstico ou interpretação de exames
- Solicitação de receitas sem consulta prévia`,
  },
  {
    label: "Psicologia",
    emoji: "🧠",
    content: `## ESPECIALIDADE: PSICOLOGIA

### Tom e Abordagem
Mantenha sempre tom acolhedor, empático e sem julgamentos.
Nunca minimize sentimentos ou dificuldades do cliente.
Use linguagem simples e acessível, evite termos clínicos desnecessários.

### Tipos de Atendimento
- Consulta inicial / avaliação
- Acompanhamento semanal / quinzenal
- Psicoterapia individual
- Atendimento a criança e adolescente
- Orientação parental
- Avaliação psicológica

### Situações de Crise
Se o cliente mencionar pensamentos de autolesão ou suicídio:
1. Demonstre cuidado e não minimize
2. Transfira IMEDIATAMENTE para atendimento humano
3. Informe o CVV: ligue 188 (24h)

### Privacidade
Nunca peça informações detalhadas sobre sintomas ou histórico via chat.
O agente apenas agenda — a avaliação é feita pelo(a) psicólogo(a).

### Transferir para Humano
- Qualquer menção a crise, autolesão ou emergência emocional
- Dúvidas sobre abordagens terapêuticas
- Pedido de segunda opinião ou encaminhamento`,
  },
  {
    label: "Estética",
    emoji: "✨",
    content: `## ESPECIALIDADE: ESTÉTICA E BELEZA

### Tipos de Procedimento
- Limpeza de pele / higienização
- Peeling químico ou físico
- Microagulhamento
- Botox / toxina botulínica
- Preenchimento labial / facial
- Depilação a laser
- Drenagem linfática
- Massagem modeladora
- Radiofrequência

### Orientações Pré-Procedimento
Para procedimentos com toxina/preenchimento: evitar álcool 24h antes.
Para peeling: não usar ácidos ou esfoliantes 3 dias antes.
Para laser: pele sem bronzeado recente e sem uso de retinol.

### Orientações Pós-Procedimento
Sempre reforce a importância do protetor solar após qualquer procedimento facial.
Hidratação extra nos primeiros dias após peeling ou microagulhamento.

### Contraindicações Comuns
Gravidez, amamentação, uso de anticoagulantes, alergias a componentes — sempre informar ao agendar e confirmar com a profissional.

### Transferir para Humano
- Dúvidas sobre indicação de procedimentos específicos
- Histórico de alergias ou reações anteriores
- Orçamentos para pacotes ou tratamentos combinados`,
  },
];

// ─── componente ───────────────────────────────────────────────────────────────

export function AgentConfigModal({
  open,
  onClose,
  supabase,
  clinicId,
}: {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient | null;
  clinicId: string;
}) {
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // carrega as instruções existentes
  useEffect(() => {
    if (!open || !supabase || !clinicId) return;
    setLoading(true);
    setError(null);
    supabase
      .from("clinics")
      .select("agent_instructions")
      .eq("id", clinicId)
      .single()
      .then(({ data, error: e }) => {
        setLoading(false);
        if (e) { setError(e.message); return; }
        setInstructions(data?.agent_instructions ?? "");
      });
  }, [open, supabase, clinicId]);

  async function handleSave() {
    if (!supabase) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase
      .from("clinics")
      .update({ agent_instructions: instructions || null })
      .eq("id", clinicId);
    setSaving(false);
    if (e) { setError(e.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function applyTemplate(content: string) {
    setInstructions((prev) => {
      // se já tem conteúdo, adiciona uma linha em branco antes
      if (prev.trim()) return prev.trimEnd() + "\n\n" + content;
      return content;
    });
    setSaved(false);
  }

  if (!open) return null;

  return (
    <>
      {/* backdrop */}
      <div
        className="fixed inset-0 z-40 bg-[#1c1917]/45 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden
      />

      {/* painel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Configuração do Agente IA"
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border border-[#e4ddd3] bg-[linear-gradient(180deg,#fffdf9_0%,#f8f4ec_100%)] shadow-[0_-8px_48px_-8px_rgba(44,40,37,0.25)] sm:inset-0 sm:m-auto sm:max-h-[90dvh] sm:w-full sm:max-w-2xl sm:rounded-3xl"
      >
        {/* cabeçalho */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#ebe6dd] px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1f1c1a]">
              Configuração do Agente IA
            </h2>
            <p className="mt-0.5 text-xs text-[#8a8278]">
              Instruções específicas para o assistente virtual da sua clínica
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8a8278] transition-colors hover:bg-[#ece7df] hover:text-[#2c2825]"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* conteúdo */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* templates */}
          <div className="shrink-0 border-b border-[#ebe6dd] px-6 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#8a8278]">
              Modelos prontos
            </p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => applyTemplate(t.content)}
                  className="flex items-center gap-1.5 rounded-xl border border-[#d8cfe8] bg-[#f8f6fc] px-3 py-1.5 text-xs font-semibold text-[#5c4d7a] transition-colors hover:bg-[#f0ebf8] hover:border-[#6b5b95]/50"
                >
                  <span>{t.emoji}</span>
                  {t.label}
                </button>
              ))}
              {instructions && (
                <button
                  type="button"
                  onClick={() => { setInstructions(""); setSaved(false); }}
                  className="flex items-center gap-1.5 rounded-xl border border-[#e8c8c8] bg-[#fdf4f4] px-3 py-1.5 text-xs font-semibold text-[#7a2a2a] transition-colors hover:bg-[#fce8e8]"
                >
                  Limpar tudo
                </button>
              )}
            </div>
          </div>

          {/* textarea */}
          <div className="flex flex-1 flex-col overflow-hidden px-6 py-4">
            {loading ? (
              <div className="flex flex-1 items-center justify-center">
                <span className="text-sm text-[#8a8278]">A carregar…</span>
              </div>
            ) : (
              <textarea
                value={instructions}
                onChange={(e) => { setInstructions(e.target.value); setSaved(false); }}
                placeholder={`Escreva aqui as instruções específicas da sua clínica…

Exemplos:
• Especialidade e tipo de atendimento
• Tom e comportamento do agente
• Fluxos específicos (urgência, triagem, pós-procedimento)
• O que transferir para atendimento humano

Pode usar os modelos prontos acima como ponto de partida.`}
                className="flex-1 resize-none rounded-2xl border border-[#ddd8d0] bg-white/80 px-4 py-3 text-sm leading-relaxed text-[#2c2825] placeholder-[#b8b0a6] shadow-inner outline-none transition-[border-color,box-shadow] focus:border-[#3d6b62] focus:shadow-[0_0_0_3px_rgba(61,107,98,0.12)] focus:ring-0"
                spellCheck={false}
              />
            )}
          </div>

          {/* rodapé */}
          <div className="shrink-0 border-t border-[#ebe6dd] px-6 py-4">
            {error && (
              <p className="mb-3 rounded-xl bg-[#fdf4f4] px-3 py-2 text-xs font-medium text-[#7a2a2a]">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-[#8a8278]">
                As instruções são adicionadas automaticamente ao sistema do agente.
              </p>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || loading}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold shadow-sm transition-all disabled:opacity-60 ${
                  saved
                    ? "bg-[#2a5a22] text-white"
                    : "bg-gradient-to-b from-[#4a7c72] to-[#3d6b62] text-white hover:-translate-y-px hover:shadow-md"
                }`}
              >
                {saving ? "A guardar…" : saved ? "✓ Guardado" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
