export type AgentPlaceholderContext = {
  nomeAgente: string;
  nomeClinica: string;
  quemSomos: string;
  endereco: string;
};

/**
 * Substitui marcadores nas instruções do agente (ex.: secção Identidade).
 * O fluxo n8n aplica a mesma lógica ao montar o texto para o modelo.
 */
export function expandAgentIdentityPlaceholders(
  text: string,
  context: AgentPlaceholderContext
): string {
  const rep = (s: string, ph: string, v: string) => s.split(ph).join(v);
  const a = context.nomeAgente.trim();
  const c = context.nomeClinica.trim();
  const q = context.quemSomos.trim();
  const e = context.endereco.trim();
  const agentLabel = a || "(nome do agente acima)";
  const clinicLabel = c || "(nome da clínica no cadastro)";
  const quemLabel = q || "(preencha «Quem somos» acima)";
  const endLabel = e || "(preencha «Endereço» acima)";
  let o = text;
  o = rep(o, "{{name}}", agentLabel);
  o = rep(o, "{{nome_agente}}", agentLabel);
  o = rep(o, "{{agente}}", agentLabel);
  o = rep(o, "{{clinica}}", clinicLabel);
  o = rep(o, "{{nome_clinica}}", clinicLabel);
  o = rep(o, "{{clinic}}", clinicLabel);
  o = rep(o, "{{quem_somos}}", quemLabel);
  o = rep(o, "{{sobre}}", quemLabel);
  o = rep(o, "{{endereco}}", endLabel);
  o = rep(o, "{{morada}}", endLabel);
  o = rep(o, "{{endereco_clinica}}", endLabel);
  return o;
}
