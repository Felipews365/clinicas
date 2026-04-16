"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expandAgentIdentityPlaceholders } from "@/lib/agent-placeholders";
import { buildAgentInstructionsMarkdown, type AgentExtraClinicInfo } from "@/lib/agent-instructions-markdown";
import {
  type AgentSectionKey,
  type AgentSectionsState,
  CLINIC_MODEL_OPTIONS,
  type ClinicModelId,
  getPresetForClinicModel,
  normalizeClinicModelId,
} from "@/lib/agent-clinic-model";

// ─── secções configuráveis ────────────────────────────────────────────────────

type AgentConfig = AgentSectionsState;

const EMPTY_CONFIG: AgentConfig = {
  identidade: "",
  triagem: "",
  tom: "",
  orientacoes: "",
  transferir: "",
  outros: "",
};

const SECTIONS: {
  key: AgentSectionKey;
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
    placeholder:
      "Ex: Sou {{name}}, atendente virtual da {{clinica}}, especializada em Odontologia. {{name}} e {{clinica}} vêm do nome do agente (acima) e do nome da clínica no cadastro.",
    templates: [
      {
        label: "Odontologia",
        value:
          'Você é {{name}}, atendente virtual da {{clinica}}, especializada em Odontologia.\nApresente-se sempre de forma acolhedora, pois muitos pacientes têm ansiedade dentária.\nDiga: "Olá! Sou {{name}}, atendente da {{clinica}}. Estou aqui para ajudar com agendamentos e dúvidas. Como posso te ajudar hoje?"',
      },
      {
        label: "Clínica Geral",
        value:
          'Você é {{name}}, atendente virtual da {{clinica}}.\nDiga: "Olá! Sou {{name}}, da {{clinica}}. Como posso te ajudar hoje?"',
      },
      {
        label: "Estética",
        value:
          'Você é {{name}}, atendente virtual da {{clinica}} (estética e beleza).\nUse tom leve, moderno e acolhedor.\nDiga: "Olá! Bem-vindo(a) à {{clinica}}. Posso ajudar com agendamentos e informações sobre nossos tratamentos."',
      },
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
      { label: "Informações da Clínica", value: "Endereço: [preencher]\nHorário: Segunda a Sexta 8h–20h | Sábado 8h–12h\nEstacionamento: [gratuito / pago / rua]\nConvénios aceites: [listar ou 'não aceitamos convénios']\nFormas de pagamento: dinheiro, cartão, Pix" },
    ],
  },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

/** JSON guardado pode ter secções a null; normalizar evita .trim() em null. */
function normalizeAgentConfig(
  partial: Partial<Record<AgentSectionKey, unknown>>
): AgentConfig {
  const out = { ...EMPTY_CONFIG };
  for (const key of Object.keys(EMPTY_CONFIG) as AgentSectionKey[]) {
    const v = partial[key];
    out[key] = typeof v === "string" ? v : "";
  }
  return out;
}

function parseConfig(raw: string | null): AgentConfig {
  if (!raw) return { ...EMPTY_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { procedimentos: _drop, ...rest } = parsed as Record<string, unknown>;
    return normalizeAgentConfig({ ...EMPTY_CONFIG, ...rest });
  } catch {
    return { ...EMPTY_CONFIG, outros: raw };
  }
}

// ─── tipos para procedimentos ─────────────────────────────────────────────────

type ProcRow = {
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

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PARCELAS_OPTS = ["", ...Array.from({ length: 24 }, (_, i) => String(i + 1))];

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

function rowToPayDraft(r: ProcRow): PayDraft {
  return {
    price_brl: r.price_brl != null ? String(r.price_brl) : "",
    preco_a_vista_brl: r.preco_a_vista_brl != null ? String(r.preco_a_vista_brl) : "",
    tem_desconto: Boolean(r.tem_desconto),
    desconto_percentual: r.desconto_percentual != null ? String(r.desconto_percentual) : "",
    cartao_parcelas_max: r.cartao_parcelas_max != null ? String(r.cartao_parcelas_max) : "",
  };
}

function rowToRowDraft(r: ProcRow): RowEditDraft {
  return {
    name: r.name,
    description: r.description ?? "",
    duration_minutes: String(r.duration_minutes),
    ...rowToPayDraft(r),
  };
}

function paymentSummary(r: ProcRow): string {
  const bits: string[] = [];
  if (r.price_brl != null) bits.push(brl.format(Number(r.price_brl)));
  if (r.preco_a_vista_brl != null) bits.push(`à vista ${brl.format(Number(r.preco_a_vista_brl))}`);
  if (r.tem_desconto) bits.push(r.desconto_percentual != null ? `desconto ${Number(r.desconto_percentual)}%` : "com desconto");
  if (r.cartao_parcelas_max != null) bits.push(`cartão até ${r.cartao_parcelas_max}x`);
  return bits.length ? bits.join(" · ") : "sem valores definidos";
}

const inputClsSm = "mt-0.5 w-full rounded-md border border-[#d4cfc4] px-2 py-1.5 text-xs text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-1";
const inputCls = "mt-0.5 w-full rounded-lg border border-[#d4cfc4] px-3 py-2 text-sm text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-2";

// ─── secção inline de procedimentos ──────────────────────────────────────────

export function ProceduresSectionInline({
  supabase,
  clinicId,
  modalOpen,
  procedureIdeas,
}: {
  supabase: SupabaseClient | null;
  clinicId: string;
  modalOpen: boolean;
  /** Sugestões de nomes conforme o modelo da clínica (só informativo). */
  procedureIdeas?: string[];
}) {
  const [rows, setRows] = useState<ProcRow[]>([]);
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
  const [rowDraftById, setRowDraftById] = useState<Record<string, RowEditDraft>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from("clinic_procedures")
      .select("id, name, description, duration_minutes, price_brl, preco_a_vista_brl, tem_desconto, desconto_percentual, cartao_parcelas_max, is_active, sort_order")
      .eq("clinic_id", clinicId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    setLoading(false);
    if (e) { setError(e.message); setRows([]); return; }
    const list = (data ?? []) as ProcRow[];
    setRows(list);
    setRowDraftById(Object.fromEntries(list.map((r) => [r.id, rowToRowDraft(r)])));
  }, [supabase, clinicId]);

  useEffect(() => {
    if (!modalOpen) return;
    void load();
    setName(""); setDescription(""); setDurationMinutes("60");
    setPriceBrl(""); setPrecoAvistaBrl("");
    setTemDesconto(false); setDescontoPercent(""); setCartaoParcelasMax("");
    setExpandedId(null); setError(null);
  }, [modalOpen, load]);

  function validateDraft(d: RowEditDraft): string | null {
    if (!d.name.trim()) return "O nome do procedimento é obrigatório.";
    const dm = parseInt(d.duration_minutes, 10);
    if (!Number.isFinite(dm) || dm < 1 || dm > 480) return "Duração deve ser entre 1 e 480 minutos.";
    if (d.price_brl.trim() && parsePriceBrlInput(d.price_brl) === null) return "Preço tabela inválido.";
    if (d.preco_a_vista_brl.trim() && parsePriceBrlInput(d.preco_a_vista_brl) === null) return "Preço à vista inválido.";
    if (d.tem_desconto && d.desconto_percentual.trim() && parsePercentInput(d.desconto_percentual) === null) return "Percentual de desconto inválido (use 0–100).";
    if (d.cartao_parcelas_max.trim() && parseParcelasSelect(d.cartao_parcelas_max) === null) return "Parcelas no cartão: escolha entre 1 e 24.";
    return null;
  }

  function draftToPayload(d: PayDraft) {
    return {
      price_brl: parsePriceBrlInput(d.price_brl),
      preco_a_vista_brl: parsePriceBrlInput(d.preco_a_vista_brl),
      tem_desconto: d.tem_desconto,
      desconto_percentual: d.tem_desconto ? parsePercentInput(d.desconto_percentual) : null,
      cartao_parcelas_max: parseParcelasSelect(d.cartao_parcelas_max),
    };
  }

  async function addProcedure(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    const n = name.trim();
    if (!n) return;
    const draft: RowEditDraft = { name: n, description, duration_minutes: durationMinutes, price_brl: priceBrl, preco_a_vista_brl: precoAvistaBrl, tem_desconto: temDesconto, desconto_percentual: descontoPercent, cartao_parcelas_max: cartaoParcelasMax };
    const verr = validateDraft(draft);
    if (verr) { setError(verr); return; }
    setBusy("add"); setError(null);
    const maxSort = rows.reduce((m, r) => Math.max(m, r.sort_order), -1);
    const { error: insE } = await supabase.from("clinic_procedures").insert({
      clinic_id: clinicId, name: n, description: description.trim() || null,
      duration_minutes: parseInt(durationMinutes, 10), ...draftToPayload(draft),
      is_active: true, sort_order: maxSort + 1,
    });
    setBusy(null);
    if (insE) { setError(insE.code === "23505" ? "Já existe um procedimento com este nome." : insE.message); return; }
    setName(""); setDescription(""); setDurationMinutes("60");
    setPriceBrl(""); setPrecoAvistaBrl(""); setTemDesconto(false); setDescontoPercent(""); setCartaoParcelasMax("");
    await load();
  }

  async function saveRowEdits(r: ProcRow) {
    if (!supabase) return;
    const d = rowDraftById[r.id] ?? rowToRowDraft(r);
    const verr = validateDraft(d);
    if (verr) { setError(verr); return; }
    setBusy(r.id); setError(null);
    const { error: u } = await supabase.from("clinic_procedures").update({
      name: d.name.trim(), description: d.description.trim() || null,
      duration_minutes: parseInt(d.duration_minutes, 10), ...draftToPayload(d),
    }).eq("id", r.id).eq("clinic_id", clinicId);
    setBusy(null);
    if (u) { setError(u.code === "23505" ? "Já existe outro procedimento com este nome." : u.message); return; }
    await load();
  }

  async function removeRow(r: ProcRow) {
    if (!supabase) return;
    if (!window.confirm(`Apagar permanentemente o procedimento «${r.name}»?\n\nEsta ação não pode ser desfeita.`)) return;
    setBusy(r.id); setError(null);
    const { data: removed, error: d } = await supabase.from("clinic_procedures").delete().eq("id", r.id).eq("clinic_id", clinicId).select("id");
    setBusy(null);
    if (d) { setError(d.message); return; }
    if (!removed?.length) { setError("Nenhuma linha foi apagada."); return; }
    setRowDraftById((prev) => { const next = { ...prev }; delete next[r.id]; return next; });
    setExpandedId((cur) => (cur === r.id ? null : cur));
    await load();
  }

  function setRowDraft(id: string, patch: Partial<RowEditDraft>) {
    setRowDraftById((prev) => {
      const row = rows.find((x) => x.id === id);
      const base = prev[id] ?? (row ? rowToRowDraft(row) : { name: "", description: "", duration_minutes: "60", price_brl: "", preco_a_vista_brl: "", tem_desconto: false, desconto_percentual: "", cartao_parcelas_max: "" });
      return { ...prev, [id]: { ...base, ...patch } };
    });
  }

  return (
    <div>
      <div className="space-y-4 bg-[#faf8f4] p-4">
        {procedureIdeas && procedureIdeas.length > 0 ? (
          <div className="rounded-xl border border-[#dfe8e6] bg-[#f0faf8] px-3 py-2.5">
            <p className="text-[11px] font-semibold text-[#1f2a2a]">
              Ideias de procedimentos / consultas para o modelo atual
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#5f7474]">
              {procedureIdeas.join(" · ")}
            </p>
            <p className="mt-1.5 text-[10px] text-[#8a8278]">
              Use como referência ao cadastrar — o agente só oferece o que estiver registado abaixo.
            </p>
          </div>
        ) : null}
        {/* formulário de novo procedimento */}
        <form onSubmit={(e) => void addProcedure(e)} className="space-y-3 rounded-xl border border-[#e6e1d8] bg-white p-4">
          <p className="text-xs font-semibold text-[#2c2825]">Novo procedimento</p>
          <input required placeholder="Nome (ex.: Consulta de rotina)" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          <textarea placeholder="Descrição curta (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
          <label className="block text-xs font-medium text-[#5c5348]">
            Duração estimada (minutos)
            <input type="number" min={1} max={480} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} className={inputCls} />
          </label>

          <div className="rounded-lg border border-[#e8e4dc] bg-[#faf8f5] p-3">
            <p className="mb-2 text-xs font-semibold text-[#4a453d]">Pagamento e condições</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[11px] font-medium text-[#5c5348]">
                Preço tabela / referência (R$, opcional)
                <input type="text" inputMode="decimal" placeholder="ex.: 200" value={priceBrl} onChange={(e) => setPriceBrl(e.target.value)} className={inputClsSm} />
              </label>
              <label className="block text-[11px] font-medium text-[#5c5348]">
                À vista (R$, opcional)
                <input type="text" inputMode="decimal" placeholder="ex.: 180" value={precoAvistaBrl} onChange={(e) => setPrecoAvistaBrl(e.target.value)} className={inputClsSm} />
              </label>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-medium text-[#5c5348]">
              <input type="checkbox" checked={temDesconto} onChange={(e) => setTemDesconto(e.target.checked)} className="h-4 w-4 rounded border-[#c4bdb0] text-[#4D6D66]" />
              Há desconto sobre o preço
            </label>
            {temDesconto && (
              <label className="mt-2 block text-[11px] font-medium text-[#5c5348]">
                Desconto (%)
                <input type="text" inputMode="decimal" placeholder="ex.: 10" value={descontoPercent} onChange={(e) => setDescontoPercent(e.target.value)} className={inputClsSm} />
              </label>
            )}
            <label className="mt-3 block text-[11px] font-medium text-[#5c5348]">
              Cartão — parcelar em até
              <select value={cartaoParcelasMax} onChange={(e) => setCartaoParcelasMax(e.target.value)} className={inputClsSm}>
                <option value="">Não definido / à combinar</option>
                {PARCELAS_OPTS.slice(1).map((x) => (<option key={x} value={x}>{x}x</option>))}
              </select>
            </label>
          </div>

          <button type="submit" disabled={busy === "add"} className="w-full rounded-lg bg-[#4D6D66] py-2 text-sm font-semibold text-white hover:bg-[#3f5c56] disabled:opacity-50">
            {busy === "add" ? "A guardar…" : "Adicionar procedimento"}
          </button>
        </form>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>
        )}

        {/* lista de procedimentos */}
        {loading ? (
          <p className="text-xs text-[#6b635a]">A carregar…</p>
        ) : (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-[#5c5348]">Procedimentos cadastrados</p>
            {rows.length === 0 ? (
              <p className="text-xs text-[#8a8278]">Nenhum procedimento ainda. Adicione os que o agente deve oferecer ao paciente.</p>
            ) : (
              <ul className="space-y-1.5" role="list">
                {rows.map((r) => {
                  const d = rowDraftById[r.id] ?? rowToRowDraft(r);
                  const isOpen = expandedId === r.id;
                  const listLabel = (d.name || r.name).trim() || "Sem nome";
                  return (
                    <li key={r.id} className="list-none overflow-hidden rounded-xl border border-[#e6e1d8] bg-white">
                      <button
                        type="button"
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#faf8f5] ${isOpen ? "bg-[#f5f3ef]" : ""}`}
                        aria-expanded={isOpen}
                        onClick={() => setExpandedId(isOpen ? null : r.id)}
                      >
                        <span className="min-w-0 flex-1 text-sm font-medium text-[#2c2825]">{listLabel}</span>
                        {!r.is_active && (
                          <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-zinc-700">Inativo</span>
                        )}
                        <span className="shrink-0 text-xs text-[#8a8278]" aria-hidden>{isOpen ? "▲" : "▼"}</span>
                      </button>

                      {isOpen && (
                        <div className="space-y-3 border-t border-[#ebe6dd] bg-[#faf8f5]/90 px-3 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8a8278]">Editar procedimento</p>
                          <div className="space-y-2">
                            <label className="block text-[11px] font-medium text-[#5c5348]">
                              Nome
                              <input type="text" value={d.name} onChange={(e) => setRowDraft(r.id, { name: e.target.value })} className={inputClsSm} />
                            </label>
                            <label className="block text-[11px] font-medium text-[#5c5348]">
                              Descrição (opcional)
                              <textarea value={d.description} onChange={(e) => setRowDraft(r.id, { description: e.target.value })} rows={2} className={`${inputClsSm} resize-none`} />
                            </label>
                            <label className="block text-[11px] font-medium text-[#5c5348]">
                              Duração (minutos)
                              <input type="number" min={1} max={480} value={d.duration_minutes} onChange={(e) => setRowDraft(r.id, { duration_minutes: e.target.value })} className={inputClsSm} />
                            </label>
                          </div>

                          <div className="space-y-2 border-t border-dashed border-[#e3ded6] pt-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8a8278]">Pagamento e condições</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <label className="text-[10px] font-medium text-[#8a8278]">
                                Tabela (R$, opcional)
                                <input type="text" inputMode="decimal" value={d.price_brl} onChange={(e) => setRowDraft(r.id, { price_brl: e.target.value })} className={inputClsSm} />
                              </label>
                              <label className="text-[10px] font-medium text-[#8a8278]">
                                À vista (R$, opcional)
                                <input type="text" inputMode="decimal" value={d.preco_a_vista_brl} onChange={(e) => setRowDraft(r.id, { preco_a_vista_brl: e.target.value })} className={inputClsSm} />
                              </label>
                            </div>
                            <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-[#5c5348]">
                              <input type="checkbox" checked={d.tem_desconto} onChange={(e) => setRowDraft(r.id, { tem_desconto: e.target.checked })} className="h-3.5 w-3.5 rounded border-[#c4bdb0]" />
                              Desconto
                            </label>
                            {d.tem_desconto && (
                              <label className="block text-[10px] font-medium text-[#8a8278]">
                                % desconto
                                <input type="text" inputMode="decimal" value={d.desconto_percentual} onChange={(e) => setRowDraft(r.id, { desconto_percentual: e.target.value })} className={inputClsSm} />
                              </label>
                            )}
                            <label className="block text-[10px] font-medium text-[#8a8278]">
                              Cartão até
                              <select value={d.cartao_parcelas_max} onChange={(e) => setRowDraft(r.id, { cartao_parcelas_max: e.target.value })} className={inputClsSm}>
                                <option value="">—</option>
                                {PARCELAS_OPTS.slice(1).map((x) => (<option key={x} value={x}>{x}x</option>))}
                              </select>
                            </label>
                          </div>

                          <div className="flex flex-wrap gap-2 border-t border-[#efeae3] pt-3">
                            <button type="button" disabled={busy === r.id} onClick={(e) => { e.stopPropagation(); void saveRowEdits(r); }} className="rounded-md bg-[#4D6D66] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3f5c56] disabled:opacity-50">
                              {busy === r.id ? "A guardar…" : "Guardar alterações"}
                            </button>
                            <button type="button" disabled={busy === r.id} onClick={() => void removeRow(r)} className="rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50">
                              Apagar
                            </button>
                          </div>
                          <p className="text-[10px] text-[#9a9288]">
                            Último guardado: ~{r.duration_minutes} min · {paymentSummary(r)}
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
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
  isOpen,
  onToggle,
  beforeHint,
  afterTextarea,
  showConfiguredDot,
}: {
  emoji: string;
  title: string;
  hint: string;
  placeholder: string;
  value: string;
  templates: { label: string; value: string }[];
  onChange: (v: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  /** Conteúdo no topo da área expandida (ex.: nome do agente em Identidade). */
  beforeHint?: ReactNode;
  afterTextarea?: ReactNode;
  /** Mostrar ponto «configurado» mesmo sem texto na textarea (ex.: só nome do agente). */
  showConfiguredDot?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e4ddd3] bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition-colors hover:bg-[#faf7f2]"
      >
        <span className="text-base">{emoji}</span>
        <p className="flex-1 text-sm font-semibold text-[#1f1c1a]">{title}</p>
        {((value ?? "").trim() || showConfiguredDot) && (
          <span className="h-2 w-2 rounded-full bg-[#3d6b62]" aria-label="configurado" />
        )}
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 shrink-0 text-[#8a8278] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        >
          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>

      {isOpen && (
        <div className="space-y-2 border-t border-[#ebe6dd] px-4 pb-4 pt-3">
          {beforeHint}
          <p className="text-xs text-[#8a8278]">{hint}</p>

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
              {(value ?? "").trim() && (
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
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={4}
            className="w-full resize-y rounded-xl border border-[#ddd8d0] bg-white px-3 py-2.5 text-sm leading-relaxed text-[#2c2825] placeholder-[#b8b0a6] shadow-inner outline-none transition-[border-color,box-shadow] focus:border-[#3d6b62] focus:shadow-[0_0_0_3px_rgba(61,107,98,0.12)]"
            spellCheck={false}
          />
          {afterTextarea}
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
  presentation = "modal",
}: {
  open: boolean;
  onClose: () => void;
  supabase: SupabaseClient | null;
  clinicId: string;
  presentation?: "modal" | "panel";
}) {
  const [config, setConfig] = useState<AgentConfig>({ ...EMPTY_CONFIG });
  const [nomeAgente, setNomeAgente] = useState<string>("");
  const [saudacaoNovo, setSaudacaoNovo] = useState<string>("");
  const [saudacaoRetorno, setSaudacaoRetorno] = useState<string>("");
  const [clinicName, setClinicName] = useState<string>("");
  // quemSomos/enderecoClinica lidos do DB apenas para preview — editáveis em "Clínica / Perfil"
  const [quemSomos, setQuemSomos] = useState<string>("");
  const [enderecoClinica, setEnderecoClinica] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [clinicModel, setClinicModel] = useState<ClinicModelId>("clinica_geral");

  /** Acordeão: só uma secção aberta; clicar na aberta fecha. */
  function toggleAccordionSection(key: string) {
    setOpenSection((prev) => (prev === key ? null : key));
  }

  useEffect(() => {
    if (open) setOpenSection(null);
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
        const raw = data?.agent_instructions ?? null;
        setConfig(parseConfig(raw));
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          setClinicModel(normalizeClinicModelId(parsed.clinic_model));
          setNomeAgente(parsed.nome_agente ?? "");
          setSaudacaoNovo(typeof parsed.saudacao_novo === "string" ? parsed.saudacao_novo : "");
          setSaudacaoRetorno(typeof parsed.saudacao_retorno === "string" ? parsed.saudacao_retorno : "");
          // lidos apenas para preview na identidade
          setQuemSomos(typeof parsed.quem_somos === "string" ? parsed.quem_somos : "");
          setEnderecoClinica(typeof parsed.endereco === "string" ? parsed.endereco : "");
        } catch {
          setClinicModel("clinica_geral");
          setQuemSomos("");
          setEnderecoClinica("");
        }
      });
  }, [open, supabase, clinicId]);

  const identidadePreview = useMemo(
    () =>
      expandAgentIdentityPlaceholders(config.identidade ?? "", {
        nomeAgente,
        nomeClinica: clinicName,
        quemSomos,
        endereco: enderecoClinica,
      }),
    [config.identidade, nomeAgente, clinicName, quemSomos, enderecoClinica]
  );

  function updateSection(key: AgentSectionKey, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function selectClinicModel(id: ClinicModelId) {
    if (id === clinicModel) return;
    setClinicModel(id);
    setConfig(getPresetForClinicModel(id));
    setSaved(false);
  }

  async function handleSave() {
    if (!supabase) return;
    setSaving(true);
    setError(null);
    // Read-modify-write: preserva campos de "Clínica / Perfil" (endereço, convênio, lembrete…)
    const { data: current } = await supabase
      .from("clinics")
      .select("agent_instructions")
      .eq("id", clinicId)
      .single();
    let existing: Record<string, unknown> = {};
    try {
      existing = current?.agent_instructions ? JSON.parse(current.agent_instructions as string) : {};
    } catch { /* noop */ }
    const extra: AgentExtraClinicInfo = {
      aceitaConvenio: typeof existing.aceita_convenio === "boolean" ? existing.aceita_convenio : null,
      linkLocalizacao: typeof existing.link_localizacao === "string" ? existing.link_localizacao : null,
    };
    const merged = {
      ...existing,
      ...config,
      clinic_model: clinicModel,
      instructions_markdown: buildAgentInstructionsMarkdown(config, clinicModel, extra),
      nome_agente: nomeAgente.trim() || null,
      saudacao_novo: saudacaoNovo.trim() || null,
      saudacao_retorno: saudacaoRetorno.trim() || null,
    };
    const { error: e } = await supabase
      .from("clinics")
      .update({ agent_instructions: JSON.stringify(merged) })
      .eq("id", clinicId);
    setSaving(false);
    if (e) { setError(e.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const filledCount = Object.values(config).filter((v) => (v ?? "").trim()).length;

  if (!open) return null;

  const isPanel = presentation === "panel";



  const shell = (
      <div
        role={isPanel ? "region" : "dialog"}
        aria-modal={isPanel ? undefined : true}
        aria-label="Configuração do Agente IA"
        className={
          isPanel
            ? "relative flex min-h-0 w-full min-w-0 max-w-none flex-col rounded-2xl border border-[#e4ddd3] bg-[linear-gradient(180deg,#fffdf9_0%,#f8f4ec_100%)] shadow-sm"
            : "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border border-[#e4ddd3] bg-[linear-gradient(180deg,#fffdf9_0%,#f8f4ec_100%)] shadow-[0_-8px_48px_-8px_rgba(44,40,37,0.25)] sm:inset-0 sm:m-auto sm:max-h-[90dvh] sm:w-full sm:max-w-2xl sm:rounded-3xl"
        }
      >
        {/* cabeçalho */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#ebe6dd] px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[#1f1c1a]">
              Agente IA
            </h2>
            <p className="mt-0.5 text-xs text-[#8a8278]">
              {(() => {
                const m = CLINIC_MODEL_OPTIONS.find((o) => o.id === clinicModel);
                const prefix = m ? `${m.emoji} ${m.label} · ` : "";
                return filledCount > 0
                  ? `${prefix}${filledCount} de ${SECTIONS.length} secções configuradas`
                  : `${prefix}${"Configure como o agente deve se comportar com os seus pacientes"}`;
              })()}
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
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <span className="text-sm text-[#8a8278]">A carregar…</span>
            </div>
          ) : (
            <div className="space-y-2">
              <section
                className="clinic-model-section rounded-2xl border border-[#e4ddd3] bg-white px-4 py-4 shadow-[0_1px_2px_rgba(44,40,37,0.04)]"
                aria-labelledby="clinic-model-heading"
              >
                <h3
                  id="clinic-model-heading"
                  className="font-display text-base font-semibold tracking-tight text-[#1f1c1a]"
                >
                  Modelo da clínica
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-[#8a8278]">
                  Escolha o tipo de atendimento para adaptar o comportamento do Agente IA.
                </p>
                <p className="mt-2 text-[11px] text-[#9a9288]">
                  Ao mudar o modelo, os textos das secções abaixo são preenchidos com o perfil
                  correspondente (pode editar antes de guardar). «Outro» inicia em branco para
                  configuração totalmente manual.
                </p>

                {/* Select do modelo */}
                <select
                  aria-label="Modelo da clínica"
                  value={clinicModel}
                  onChange={(e) => selectClinicModel(e.target.value as ClinicModelId)}
                  className="mt-3 w-full rounded-lg border border-[#d4cfc4] bg-white px-3 py-2.5 text-sm text-[#1a1a1a] outline-none ring-[#4D6D66] focus:ring-1"
                >
                  {CLINIC_MODEL_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.emoji} {opt.label}
                    </option>
                  ))}
                </select>

              </section>

              {SECTIONS.map((s) => (
                <div key={s.key}>
                  <SectionCard
                      emoji={s.emoji}
                      title={s.title}
                      hint={s.hint}
                      placeholder={s.placeholder}
                      value={config[s.key]}
                      templates={s.templates}
                      onChange={(v) => updateSection(s.key, v)}
                      isOpen={openSection === s.key}
                      onToggle={() => toggleAccordionSection(s.key)}
                      showConfiguredDot={
                        s.key === "identidade" ? Boolean(nomeAgente.trim()) : false
                      }
                      beforeHint={
                        s.key === "identidade" ? (
                          <div className="mb-1 rounded-xl border border-[#e8e4dc] bg-[#faf8f5] px-3 py-3">
                            <label
                              htmlFor="agent-config-nome-agente"
                              className="text-xs font-semibold text-[#1f1c1a]"
                            >
                              Nome do Agente
                            </label>
                            <p className="mt-0.5 text-[11px] text-[#8a8278]">
                              Como o agente se identifica para os pacientes no WhatsApp. Usado em{" "}
                              <code className="rounded bg-[#f0ebe3] px-0.5">{"{{name}}"}</code> na identidade.
                            </p>
                            <input
                              id="agent-config-nome-agente"
                              type="text"
                              value={nomeAgente}
                              onChange={(e) => {
                                setNomeAgente(e.target.value);
                                setSaved(false);
                              }}
                              placeholder="Ex: Ana, Sofia, Carlos…"
                              className="mt-2 w-full max-w-md rounded-lg border border-[#d4cfc4] bg-white px-2.5 py-1.5 text-sm text-[#1a1a1a] placeholder-[#b8b0a6] outline-none ring-[#4D6D66] focus:ring-1"
                            />

                            {/* Saudação — cliente novo */}
                            <div className="mt-3 border-t border-[#ede9e2] pt-3">
                              <label
                                htmlFor="agent-config-saudacao-novo"
                                className="text-xs font-semibold text-[#1f1c1a]"
                              >
                                Saudação — cliente novo
                              </label>
                              <p className="mt-0.5 text-[11px] text-[#8a8278]">
                                Mensagem enviada ao primeiro contato. Deixe vazio para usar o padrão.
                                Use <code className="rounded bg-[#f0ebe3] px-0.5">{"{{name}}"}</code> e{" "}
                                <code className="rounded bg-[#f0ebe3] px-0.5">{"{{clinica}}"}</code>.
                              </p>
                              <textarea
                                id="agent-config-saudacao-novo"
                                rows={3}
                                value={saudacaoNovo}
                                onChange={(e) => { setSaudacaoNovo(e.target.value); setSaved(false); }}
                                placeholder={`Olá! Sou {{name}}, da {{clinica}}. Estou aqui para ajudar com agendamentos e dúvidas. Como posso te ajudar hoje? 😊`}
                                className="mt-2 w-full rounded-lg border border-[#d4cfc4] bg-white px-2.5 py-1.5 text-sm text-[#1a1a1a] placeholder-[#b8b0a6] outline-none ring-[#4D6D66] focus:ring-1"
                              />
                            </div>

                            {/* Saudação — cliente de retorno */}
                            <div className="mt-3">
                              <label
                                htmlFor="agent-config-saudacao-retorno"
                                className="text-xs font-semibold text-[#1f1c1a]"
                              >
                                Saudação — cliente de retorno
                              </label>
                              <p className="mt-0.5 text-[11px] text-[#8a8278]">
                                Mensagem para quem já foi atendido antes. Deixe vazio para usar o padrão.
                                Use <code className="rounded bg-[#f0ebe3] px-0.5">{"{{nome_cliente}}"}</code> para incluir o nome salvo.
                              </p>
                              <input
                                id="agent-config-saudacao-retorno"
                                type="text"
                                value={saudacaoRetorno}
                                onChange={(e) => { setSaudacaoRetorno(e.target.value); setSaved(false); }}
                                placeholder={`Olá, {{nome_cliente}}! Como posso te ajudar hoje? 😊`}
                                className="mt-2 w-full max-w-md rounded-lg border border-[#d4cfc4] bg-white px-2.5 py-1.5 text-sm text-[#1a1a1a] placeholder-[#b8b0a6] outline-none ring-[#4D6D66] focus:ring-1"
                              />
                            </div>
                          </div>
                        ) : undefined
                      }
                      afterTextarea={
                        s.key === "identidade" ? (
                          <div className="space-y-2 pt-1">
                            <p className="text-xs leading-relaxed text-[#8a8278]">
                              Marcadores:{" "}
                              <code className="rounded bg-[#f2ede6] px-1">{"{{name}}"}</code> (nome do agente),{" "}
                              <code className="rounded bg-[#f2ede6] px-1">{"{{clinica}}"}</code> (nome da clínica),{" "}
                              <code className="rounded bg-[#f2ede6] px-1">{"{{quem_somos}}"}</code>,{" "}
                              <code className="rounded bg-[#f2ede6] px-1">{"{{endereco}}"}</code> — configure em{" "}
                              <strong className="font-medium text-[#5c5348]">Clínica / Perfil</strong>.
                            </p>
                            {(config.identidade ?? "").trim() ? (
                              <div className="rounded-xl border border-[#e6e1d8] bg-[#faf8f5] px-3 py-2.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8a8278]">
                                  Pré-visualização
                                </p>
                                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[#2c2825]">
                                  {identidadePreview}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        ) : undefined
                      }
                    />
                </div>
              ))}
            </div>
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
              {filledCount > 0 ? `${filledCount} de ${SECTIONS.length} secções preenchidas` : "Preencha as secções que desejar e guarde."}
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
  );

  if (isPanel) {
    return (
      <div className="w-full min-w-0 pb-2" role="region" aria-label="Agente IA">
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
