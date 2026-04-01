/**
 * Número do WhatsApp de suporte (apenas dígitos, com DDI, sem +).
 * Defina NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER no ambiente; fallback alinhado à landing.
 */
export function getSupportWhatsAppNumber(): string {
  if (typeof process === "undefined") return "5511999999999";
  const raw = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER?.replace(/\D/g, "") ?? "";
  return raw.length > 0 ? raw : "5511999999999";
}

/** Abrir conversa para ativar plano / CRM (mensagem pré-preenchida). */
export function getSupportWhatsAppActivatePlanUrl(): string {
  const text = encodeURIComponent("Quero ativar meu plano no AgendaClinic");
  return `https://wa.me/${getSupportWhatsAppNumber()}?text=${text}`;
}
