import {
  type AgentSectionKey,
  type AgentSectionsState,
  type ClinicModelId,
  clinicModelLabel,
  normalizeClinicModelId,
} from "@/lib/agent-clinic-model";

const SECTION_LABELS: Record<AgentSectionKey, string> = {
  identidade: "IDENTIDADE DO AGENTE",
  triagem: "TRIAGEM E URGÊNCIAS",
  tom: "TOM E LINGUAGEM",
  orientacoes: "ORIENTAÇÕES AO PACIENTE",
  transferir: "QUANDO TRANSFERIR PARA HUMANO",
  outros: "OUTRAS INSTRUÇÕES",
};

const EMPTY_SECTIONS: AgentSectionsState = {
  identidade: "",
  triagem: "",
  tom: "",
  orientacoes: "",
  transferir: "",
  outros: "",
};

function normalizeSections(
  partial: Partial<Record<AgentSectionKey, unknown>>
): AgentSectionsState {
  const out = { ...EMPTY_SECTIONS };
  for (const key of Object.keys(EMPTY_SECTIONS) as AgentSectionKey[]) {
    const v = partial[key];
    out[key] = typeof v === "string" ? v : "";
  }
  return out;
}

/** Blocos ### das secções preenchidas (sem cabeçalho de perfil). */
export function configSectionsToMarkdown(cfg: AgentSectionsState): string {
  return (Object.keys(SECTION_LABELS) as AgentSectionKey[])
    .filter((k) => (cfg[k] ?? "").trim())
    .map((k) => `### ${SECTION_LABELS[k]}\n${(cfg[k] ?? "").trim()}`)
    .join("\n\n");
}

/**
 * Texto agregado para o LLM: perfil da clínica + secções configuráveis.
 * Deve ser guardado em `instructions_markdown` dentro do JSON de `agent_instructions`.
 */
export function buildAgentInstructionsMarkdown(
  cfg: AgentSectionsState,
  clinicModel: ClinicModelId
): string {
  const label = clinicModelLabel(clinicModel);
  const profile = `### PERFIL DA CLÍNICA (MODELO)\nEsta clínica está configurada no perfil **${label}** (identificador: \`${clinicModel}\`). Adapte triagem, exemplos, tom e critérios de transferência para este tipo de atendimento. O detalhe operacional está nas secções seguintes.`;
  const body = configSectionsToMarkdown(cfg).trim();
  return body ? `${profile}\n\n${body}` : profile;
}

/**
 * Lê o texto guardado em `agent_instructions` (JSON) e devolve o markdown para o system prompt.
 * Usa `instructions_markdown` quando existir; caso contrário recompõe a partir das secções + `clinic_model`.
 */
export function agentInstructionsFromStoredJson(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "";
  const str = String(raw).trim();
  try {
    const parsed = JSON.parse(str) as Record<string, unknown>;
    const prebuilt =
      typeof parsed.instructions_markdown === "string"
        ? parsed.instructions_markdown.trim()
        : "";
    if (prebuilt) return prebuilt;
    const model = normalizeClinicModelId(parsed.clinic_model);
    const cfg = normalizeSections(parsed);
    return buildAgentInstructionsMarkdown(cfg, model);
  } catch {
    return str;
  }
}
