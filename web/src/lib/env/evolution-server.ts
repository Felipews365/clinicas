/**
 * Variáveis Evolution API — apenas servidor (Route Handlers).
 * Nomes exatos: EVOLUTION_API_URL, EVOLUTION_API_KEY (sem NEXT_PUBLIC_).
 * Next.js carrega web/.env.local; reinicie o servidor após alterar o ficheiro.
 */

const AJUDA_NOMES =
  "ficheiro web/.env.local; variáveis EVOLUTION_API_URL e EVOLUTION_API_KEY sem prefixo NEXT_PUBLIC_";

function limparValorEnv(valor: string | undefined): string {
  if (!valor) return "";
  return valor.trim().replace(/^["']|["']$/g, "");
}

export type ConfigEvolutionServidor = {
  url: string;
  apiKey: string;
};

export type ResultadoValidacaoEvolution =
  | { valido: true; config: ConfigEvolutionServidor }
  | {
      valido: false;
      variaveisEmFalta: ("EVOLUTION_API_URL" | "EVOLUTION_API_KEY")[];
      mensagem: string;
    };

/** Lê process.env com trim e normaliza a URL (https:// se faltar). */
export function obterConfigEvolutionServidor(): ResultadoValidacaoEvolution {
  const urlBruta = limparValorEnv(process.env.EVOLUTION_API_URL);
  const apiKey = limparValorEnv(process.env.EVOLUTION_API_KEY);

  const variaveisEmFalta: ("EVOLUTION_API_URL" | "EVOLUTION_API_KEY")[] = [];
  if (!urlBruta) variaveisEmFalta.push("EVOLUTION_API_URL");
  if (!apiKey) variaveisEmFalta.push("EVOLUTION_API_KEY");

  if (variaveisEmFalta.length > 0) {
    return {
      valido: false,
      variaveisEmFalta,
      mensagem: `Configuração incompleta: ${variaveisEmFalta.join(", ")}. Defina estes nomes exatos em ${AJUDA_NOMES}. Guarde o ficheiro e reinicie o servidor Next.js.`,
    };
  }

  let url = urlBruta.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  return { valido: true, config: { url, apiKey } };
}
