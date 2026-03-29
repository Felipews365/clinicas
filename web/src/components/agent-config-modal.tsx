"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── secções configuráveis ────────────────────────────────────────────────────

type SectionKey =
  | "identidade"
  | "triagem"
  | "procedimentos"
  | "tom"
  | "orientacoes"
  | "transferir"
  | "outros";

type AgentConfig = Record<SectionKey, string>;

const EMPTY_CONFIG: AgentConfig = {
  identidade: "",
  triagem: "",
  procedimentos: "",
  tom: "",
  orientacoes: "",
  transferir: "",
  outros: "",
};

const SECTIONS: {
  key: SectionKey;
  emoji: string;
  title: string;
  hint: string;
  placeholder: string;
  templates: { label: string; value: string }[];
}[] = [
  {
    key: "identidade",
    emoji: "🪪",
    title: "Identidade do Agente",
    hint: "Nome, especialidade e como se apresenta ao paciente.",
    placeholder: 'Ex: "Sou a Ana, assistente da Clínica Sorriso, especializada em Odontologia. Estou aqui para ajudar com agendamentos e dúvidas."',
    templates: [
      { label: "Odontologia", value: 'Você é a Ana, atendente virtual da Clínica Sorriso, especializada em Odontologia.\nApresente-se sempre de forma acolhedora, pois muitos pacientes têm ansiedade dentária.\nDiga: "Olá! Sou a Ana, atendente da Clínica Sorriso. Estou aqui para ajudar com agendamentos e dúvidas. Como posso te ajudar hoje?"' },
      { label: "Clínica Geral", value: 'Você é a assistente virtual da clínica. Apresente-se pelo nome configurado no sistema.\nDiga: "Olá! Sou a assistente da clínica. Como posso te ajudar hoje?"' },
      { label: "Estética", value: 'Você é a assistente virtual de um espaço de estética e beleza.\nUse tom leve, moderno e acolhedor.\nDiga: "Olá! Bem-vindo(a) ao nosso espaço. Posso ajudar com agendamentos e informações sobre nossos tratamentos."' },
    ],
  },
  {
    key: "triagem",
    emoji: "🚨",
    title: "Triagem e Urgências",
    hint: "Como o agente deve identificar e responder a urgências ou emergências.",
    placeholder: "Ex: Se o paciente descrever dor intensa, sangramento ou trauma, classifique como emergência e tente encaixar no mesmo dia. Para dor moderada, priorize em até 48h...",
    templates: [
      { label: "Odontologia", value: "Classifique antes de agendar:\n- EMERGÊNCIA (atender hoje): dor intensa e contínua, trauma com perda de dente, sangramento que não para, inchaço severo, abscesso visível → tente encaixar no mesmo dia\n- URGENTE (até 48h): dor moderada, bracket solto que machuca, coroa solta\n- ROTINA: limpeza, consulta de avaliação, manutenção de aparelho\n\nPara emergências, diga: \"Vou verificar o que temos disponível hoje mesmo. Enquanto isso, pode aplicar compressa fria no rosto e tomar um analgésico de venda livre.\"" },
      { label: "Clínica Geral", value: "Se o paciente descrever dor no peito, dificuldade respiratória grave ou desmaio, oriente a ligar para o SAMU (192) ou ir ao pronto-socorro imediatamente.\nPara febre alta (>39°C) ou dor forte, priorize consulta no mesmo dia ou no seguinte.\nPara consultas de rotina, siga a disponibilidade normal da agenda." },
      { label: "Psicologia", value: "Se o paciente mencionar pensamentos de autolesão ou suicídio:\n1. Demonstre cuidado e não minimize os sentimentos\n2. Transfira IMEDIATAMENTE para atendimento humano\n3. Informe o CVV: ligue 188 (24h, gratuito)\n\nPara crises emocionais agudas, tente encaixar no mesmo dia ou no seguinte." },
    ],
  },
  {
    key: "procedimentos",
    emoji: "📋",
    title: "Tipos de Procedimento / Consulta",
    hint: "Liste os procedimentos que a clínica oferece e como o agente deve apresentá-los.",
    placeholder: "Ex: Limpeza (~40 min), Restauração (~60 min), Tratamento de Canal (2-3 sessões), Clareamento (~90 min)...\nPara cada um, informe duração aproximada e se precisa de algum preparo especial.",
    templates: [
      { label: "Odontologia", value: "Procedimentos disponíveis:\n- Primeira consulta / avaliação (~30 min)\n- Limpeza / profilaxia (~40 min)\n- Restauração / obturação (~60 min)\n- Tratamento de canal (2 a 3 sessões de ~60 min)\n- Extração simples (~30 min)\n- Clareamento dental (~90 min)\n- Manutenção de aparelho ortodôntico (~30 min, a cada 30 dias)\n- Implante / prótese (múltiplas sessões, consultar)\n\nSempre use cs_consultar_servicos para valores e disponibilidade atualizada." },
      { label: "Clínica Geral", value: "Tipos de consulta:\n- Check-up / consulta preventiva (~30 min)\n- Consulta por sintoma / queixa (~30 min)\n- Renovação de receita (~15 min) — verificar se o médico exige consulta\n- Avaliação de exames (~20 min)\n- Atestado médico (junto com consulta)\n\nInforme sempre que o paciente deve chegar em jejum se o médico solicitar exames no dia." },
      { label: "Estética", value: "Tratamentos disponíveis:\n- Limpeza de pele / higienização facial (~60 min)\n- Peeling químico ou físico (~45 min)\n- Microagulhamento (~60 min)\n- Botox / toxina botulínica (~30 min)\n- Preenchimento labial ou facial (~45 min)\n- Depilação a laser (tempo varia por área)\n- Radiofrequência facial (~60 min)\n- Massagem modeladora (~60 min)\n\nSempre consultar cs_consultar_servicos para valores e disponibilidade." },
    ],
  },
  {
    key: "tom",
    emoji: "💬",
    title: "Tom e Linguagem",
    hint: "Como o agente deve se comunicar. Palavras a usar ou evitar, nível de formalidade, emojis, etc.",
    placeholder: "Ex: Use tom acolhedor e informal (tutear). Evite termos técnicos. Prefira 'desconforto' a 'dor', 'remover' a 'arrancar'. Use emojis com moderação...",
    templates: [
      { label: "Odontologia", value: "Tom: acolhedor, empático e tranquilizador. Muitos pacientes têm medo de dentista.\n\n✅ Use:\n- 'remover o dente' em vez de 'arrancar'\n- 'desconforto' em vez de 'dor'\n- 'tratamento de canal' em vez de 'desvitalização'\n- 'dormência local' em vez de 'anestesia'\n\n❌ Evite:\n- Palavras que causam ansiedade: 'doer', 'perfurar', 'arrancar', 'agulha'\n- Tom muito formal ou frio\n- Minimizar a dor do paciente\n\nUse emojis com moderação (🦷 ✅ ⏰)." },
      { label: "Formal / Profissional", value: "Tom: profissional, cordial e objetivo.\nTrate o paciente por 'você'. Evite gírias.\nSeja direto e claro, sem ser frio.\nNão use emojis em excesso — apenas para listas ou destaques." },
      { label: "Descontraído", value: "Tom: leve, amigável e próximo.\nTutear é encorajado. Use emojis para deixar a conversa mais humana.\nSeja breve e direto — ninguém quer ler parágrafos longos no WhatsApp.\nDê um toque de personalidade, mas mantenha o profissionalismo." },
    ],
  },
  {
    key: "orientacoes",
    emoji: "📌",
    title: "Orientações ao Paciente",
    hint: "Instruções antes e depois dos procedimentos que o agente pode partilhar automaticamente.",
    placeholder: "Ex: Após extração: compressa fria 20 min a cada 2h, comida morna/fria por 24h, sem álcool ou cigarro.\nAntes de cirurgia: jejum de 8h...",
    templates: [
      { label: "Odontologia", value: "Pós-extração:\n- Compressa fria: 20 min a cada 2h nas primeiras 24h\n- Alimentação: comida morna ou fria por 24h\n- Evitar: álcool, cigarro, exercícios intensos e canudinho por 48h\n- Medicação: tomar conforme prescrito\n\nPós-canal:\n- Pode sentir sensibilidade por alguns dias — é normal\n- Evitar mastigar no lado tratado até restaurar definitivamente\n\nAparelho ortodôntico:\n- Ligar imediatamente se bracket soltar ou fio machucar a gengiva\n- Manutenção mensal obrigatória" },
      { label: "Estética", value: "Pós-peeling ou microagulhamento:\n- Protetor solar obrigatório (FPS 50+) todos os dias\n- Não usar ácidos ou esfoliantes por 5 dias\n- Hidratação extra com produto indicado\n\nPós-botox / preenchimento:\n- Não deitar por 4h após aplicação\n- Evitar exercícios intensos no dia\n- Não massagear a área tratada\n\nAntes de laser:\n- Pele sem bronzeado recente\n- Suspender retinol 7 dias antes" },
    ],
  },
  {
    key: "transferir",
    emoji: "🔀",
    title: "Quando Transferir para Humano",
    hint: "Liste os casos em que o agente deve parar e transferir para atendimento humano.",
    placeholder: "Ex: Transferir se o paciente tiver dor muito intensa, se reclamar de atendimento anterior, se quiser negociar valores, se for criança pequena...",
    templates: [
      { label: "Odontologia", value: "Transferir IMEDIATAMENTE para humano:\n- Dor 10/10 ou trauma com dente quebrado/perdido\n- Criança com menos de 3 anos\n- Reclamação sobre atendimento anterior\n- Orçamento complexo (tratamento completo / reabilitação)\n- Negociação de valores ou formas de pagamento\n- Paciente confuso ou em estado emocional alterado\n- Pedido de segunda opinião clínica" },
      { label: "Geral", value: "Transferir para humano quando:\n- O paciente insistir em falar com uma pessoa\n- Situação de emergência médica\n- Reclamação ou insatisfação com o serviço\n- Pedido de desconto ou negociação de pagamento\n- Dúvidas clínicas específicas (diagnóstico, medicação, exames)\n- Orçamento personalizado ou pacote de tratamentos" },
    ],
  },
  {
    key: "outros",
    emoji: "⚙️",
    title: "Outras Instruções",
    hint: "Qualquer outra regra, comportamento ou informação que o agente deva saber.",
    placeholder: "Ex: A clínica não atende convénios. O estacionamento é gratuito. Confirmar sempre o número de telefone do paciente antes de finalizar o agendamento...",
    templates: [
      { label: "Lembretes Inteligentes", value: "Se o histórico mostrar que o paciente fez limpeza há mais de 6 meses, sugira agendar a próxima manutenção.\nSe o paciente usa aparelho ortodôntico e o último registro de manutenção for há mais de 35 dias, sugira agendar." },
      { label: "Informações da Clínica", value: "Endereço: [preencher]\nHorário: Segunda a Sexta 8h–20h | Sábado 8h–12h\nEstacionamento: [gratuito / pago / rua]\nConvénios aceites: [listar ou 'não aceitamos convénios']\nFormas de pagamento: dinheiro, cartão, Pix" },
    ],
  },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseConfig(raw: string | null): AgentConfig {
  if (!raw) return { ...EMPTY_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return { ...EMPTY_CONFIG, ...parsed };
  } catch {
    // compatibilidade: se for texto livre (versão anterior), coloca em "outros"
    return { ...EMPTY_CONFIG, outros: raw };
  }
}

function configToInstructions(cfg: AgentConfig): string {
  const labels: Record<SectionKey, string> = {
    identidade: "IDENTIDADE DO AGENTE",
    triagem: "TRIAGEM E URGÊNCIAS",
    procedimentos: "PROCEDIMENTOS / TIPOS DE CONSULTA",
    tom: "TOM E LINGUAGEM",
    orientacoes: "ORIENTAÇÕES AO PACIENTE",
    transferir: "QUANDO TRANSFERIR PARA HUMANO",
    outros: "OUTRAS INSTRUÇÕES",
  };
  return (Object.keys(labels) as SectionKey[])
    .filter((k) => cfg[k].trim())
    .map((k) => `### ${labels[k]}\n${cfg[k].trim()}`)
    .join("\n\n");
}

// ─── sub-componente: card de secção ──────────────────────────────────────────

function SectionCard({
  emoji,
  title,
  hint,
  placeholder,
  value,
  templates,
  onChange,
}: {
  emoji: string;
  title: string;
  hint: string;
  placeholder: string;
  value: string;
  templates: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`rounded-2xl border transition-colors ${value.trim() ? "border-[#c5d4d0] bg-white/80" : "border-[#e4ddd3] bg-white/50"}`}>
      {/* header clicável */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="text-xl">{emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1f1c1a]">{title}</p>
          <p className="text-xs text-[#8a8278] truncate">{value.trim() ? value.split("\n")[0].slice(0, 80) : hint}</p>
        </div>
        <span className={`shrink-0 text-[#8a8278] transition-transform ${open ? "rotate-180" : ""}`}>
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          </svg>
        </span>
        {value.trim() && (
          <span className="ml-1 h-2 w-2 shrink-0 rounded-full bg-[#3d6b62]" aria-label="configurado" />
        )}
      </button>

      {/* conteúdo expansível */}
      {open && (
        <div className="border-t border-[#e8e2d9] px-4 pb-4 pt-3 space-y-3">
          {/* templates rápidos */}
          {templates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="self-center text-xs text-[#8a8278]">Modelo:</span>
              {templates.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => onChange(t.value)}
                  className="rounded-lg border border-[#d8cfe8] bg-[#f8f6fc] px-2.5 py-1 text-xs font-medium text-[#5c4d7a] transition-colors hover:bg-[#f0ebf8]"
                >
                  {t.label}
                </button>
              ))}
              {value.trim() && (
                <button
                  type="button"
                  onClick={() => onChange("")}
                  className="rounded-lg border border-[#e8c8c8] bg-[#fdf4f4] px-2.5 py-1 text-xs font-medium text-[#7a2a2a] transition-colors hover:bg-[#fce8e8]"
                >
                  Limpar
                </button>
              )}
            </div>
          )}
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={5}
            className="w-full resize-y rounded-xl border border-[#ddd8d0] bg-white px-3 py-2.5 text-sm leading-relaxed text-[#2c2825] placeholder-[#b8b0a6] shadow-inner outline-none transition-[border-color,box-shadow] focus:border-[#3d6b62] focus:shadow-[0_0_0_3px_rgba(61,107,98,0.12)]"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}

// ─── componente principal ─────────────────────────────────────────────────────

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
  const [config, setConfig] = useState<AgentConfig>({ ...EMPTY_CONFIG });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setConfig(parseConfig(data?.agent_instructions ?? null));
      });
  }, [open, supabase, clinicId]);

  function updateSection(key: SectionKey, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    if (!supabase) return;
    setSaving(true);
    setError(null);
    const hasContent = Object.values(config).some((v) => v.trim());
    const { error: e } = await supabase
      .from("clinics")
      .update({ agent_instructions: hasContent ? JSON.stringify(config) : null })
      .eq("id", clinicId);
    setSaving(false);
    if (e) { setError(e.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const filledCount = Object.values(config).filter((v) => v.trim()).length;

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#1c1917]/45 backdrop-blur-[3px]" onClick={onClose} aria-hidden />

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
              Agente IA
            </h2>
            <p className="mt-0.5 text-xs text-[#8a8278]">
              {filledCount > 0
                ? `${filledCount} de ${SECTIONS.length} secções configuradas`
                : "Configure como o agente deve se comportar com os seus pacientes"}
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

        {/* secções */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <span className="text-sm text-[#8a8278]">A carregar…</span>
            </div>
          ) : (
            SECTIONS.map((s) => (
              <SectionCard
                key={s.key}
                emoji={s.emoji}
                title={s.title}
                hint={s.hint}
                placeholder={s.placeholder}
                value={config[s.key]}
                templates={s.templates}
                onChange={(v) => updateSection(s.key, v)}
              />
            ))
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
              Clique numa secção para expandir e editar.
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
    </>
  );
}
