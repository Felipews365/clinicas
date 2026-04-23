/**
 * Normaliza e valida WhatsApp em formato usado pela Evolution API (apenas dígitos, BR).
 * Aceita máscaras, +55, zero inicial de discagem e 55 repetido por engano.
 */

export type NormalizeProfessionalWhatsappResult =
  | { ok: true; digits: string | null }
  | { ok: false; error: string };

/** Celular BR com DDI: 55 + DDD + 9 + 8 dígitos */
const MOBILE_BR = /^55\d{2}9\d{8}$/;
/** Fixo (raro no WhatsApp): 55 + DDD + 8 dígitos */
const LANDLINE_BR = /^55\d{10}$/;

export function normalizeProfessionalWhatsappBr(
  input: string
): NormalizeProfessionalWhatsappResult {
  let d = input.replace(/\D/g, "");
  if (!d) return { ok: true, digits: null };

  while (d.startsWith("0") && d.length > 1) {
    d = d.slice(1);
  }

  while (d.length > 13 && d.startsWith("55")) {
    d = d.slice(2);
  }

  if (!d.startsWith("55")) {
    if (d.length === 10 || d.length === 11) {
      d = `55${d}`;
    } else {
      return {
        ok: false,
        error:
          "Inclua o DDD (ex.: 11999999999) ou o número completo com 55 (ex.: 5511999999999).",
      };
    }
  }

  const mobileOk = d.length === 13 && MOBILE_BR.test(d);
  const landOk = d.length === 12 && LANDLINE_BR.test(d);

  if (!mobileOk && !landOk) {
    return {
      ok: false,
      error:
        "Número inválido para o Brasil. Celular: 55 + DDD + 9 dígitos (ex.: 5511999999999). Verifique o 9 após o DDD.",
    };
  }

  return { ok: true, digits: d };
}
