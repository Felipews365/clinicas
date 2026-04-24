import { obterConfigEvolutionServidor } from "@/lib/env/evolution-server";

/** Envia texto pela instância Evolution `clinica-{clinicId}` (só servidor). */
export async function sendEvolutionClinicInstanceText(
  clinicId: string,
  phoneDigits: string,
  text: string
): Promise<{ ok: true } | { ok: false; message: string; status?: number }> {
  const evo = obterConfigEvolutionServidor();
  if (!evo.valido) {
    return { ok: false, message: "Evolution API não configurada" };
  }
  const { url: evoUrl, apiKey: evoKey } = evo.config;
  const instanceName = `clinica-${clinicId}`;
  const evoRes = await fetch(`${evoUrl}/message/sendText/${instanceName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: evoKey },
    body: JSON.stringify({ number: phoneDigits, text, delay: 1000 }),
    cache: "no-store",
  });
  if (!evoRes.ok) {
    const errBody = (await evoRes.json().catch(() => ({}))) as Record<string, unknown>;
    const msg = (errBody.message as string | undefined) ?? `Evolution erro ${evoRes.status}`;
    return { ok: false, message: msg, status: evoRes.status };
  }
  return { ok: true };
}
