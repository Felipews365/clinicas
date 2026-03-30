import type { CSSProperties } from "react";

/**
 * Paleta fixa para cor do profissional no painel (cadastro + cards).
 * Cada opção guarda o hex em `professionals.panel_color`.
 */

export type ProfessionalPaletteEntry = {
  /** Valor gravado na base */
  value: string;
  label: string;
};

export const PROFESSIONAL_PALETTE: readonly ProfessionalPaletteEntry[] = [
  { value: "#E7F7EE", label: "Verde menta" },
  { value: "#DCEEFF", label: "Azul céu" },
  { value: "#F0E8FF", label: "Lilás" },
  { value: "#FFF0E8", label: "Pêssego" },
  { value: "#FFF8E7", label: "Âmbar suave" },
  { value: "#ECEFF1", label: "Cinza neutro" },
] as const;

export const DEFAULT_PROFESSIONAL_PANEL_COLOR = PROFESSIONAL_PALETTE[0].value;

function normalizeHex(hex: string | null | undefined): string | null {
  if (!hex?.trim()) return null;
  let h = hex.trim();
  if (!h.startsWith("#")) h = `#${h}`;
  if (h.length !== 7) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return null;
  return h.toUpperCase();
}

function parseRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** Mistura cor com branco (t=1 → branco). */
export function mixWithWhite(hex: string, whitePortion: number): string {
  const rgb = parseRgb(hex);
  if (!rgb) return DEFAULT_PROFESSIONAL_PANEL_COLOR;
  const t = Math.max(0, Math.min(1, whitePortion));
  return rgbToHex(
    rgb.r + (255 - rgb.r) * t,
    rgb.g + (255 - rgb.g) * t,
    rgb.b + (255 - rgb.b) * t
  );
}

/** Escurece para texto / borda. */
function shade(hex: string, factor: number): string {
  const rgb = parseRgb(hex);
  if (!rgb) return "#5f7474";
  const f = Math.max(0, Math.min(1, factor));
  return rgbToHex(rgb.r * f, rgb.g * f, rgb.b * f);
}

export function paletteEntryForStoredColor(
  hex: string | null | undefined
): ProfessionalPaletteEntry | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  return (
    PROFESSIONAL_PALETTE.find((p) => normalizeHex(p.value) === n) ?? null
  );
}

function paletteIndexFromSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h + seed.charCodeAt(i) * (i + 1)) % 2147483647;
  }
  return Math.abs(h) % PROFESSIONAL_PALETTE.length;
}

/**
 * Estilos para o card: variáveis CSS + dados derivados para calendário.
 */
export function resolveProfessionalCardStyle(
  panelColor: string | null | undefined,
  seed: string
): {
  lightBg: string;
  lightBorder: string;
  badgeBg: string;
  badgeFg: string;
  /** Cor base de marca (calendário / detalhe) */
  accent: string;
  calendarBg: string;
  calendarBorder: string;
  calendarText: string;
} {
  let base = normalizeHex(panelColor ?? "");
  if (!base) {
    base = normalizeHex(
      PROFESSIONAL_PALETTE[paletteIndexFromSeed(seed)].value
    )!;
  } else if (!paletteEntryForStoredColor(base)) {
    base = normalizeHex(
      PROFESSIONAL_PALETTE[paletteIndexFromSeed(seed + (panelColor ?? ""))]
        .value
    )!;
  }

  const lightBg = mixWithWhite(base, 0.72);
  const lightBorder = mixWithWhite(base, 0.45);
  const badgeBg = mixWithWhite(base, 0.35);
  const badgeFg = shade(base, 0.42);

  return {
    lightBg,
    lightBorder,
    badgeBg,
    badgeFg,
    accent: base,
    calendarBg: mixWithWhite(base, 0.55),
    calendarBorder: shade(base, 0.75),
    calendarText: shade(base, 0.38),
  };
}

/** Variáveis CSS para `[data-theme="light"]` / escuro inline no card. */
export function professionalCardCssVars(
  panelColor: string | null | undefined,
  seed: string,
  theme: "light" | "dark"
): CSSProperties {
  const s = resolveProfessionalCardStyle(panelColor, seed);
  if (theme === "light") {
    return {
      "--professional-bg": s.lightBg,
      "--professional-border": s.lightBorder,
      "--professional-badge-bg": s.badgeBg,
      "--professional-badge-fg": s.badgeFg,
    } as CSSProperties;
  }
  const rgb = parseRgb(s.accent);
  if (!rgb) {
    return {
      "--professional-bg": "var(--surface)",
      "--professional-border": "var(--border)",
      "--professional-badge-bg": "var(--surface-soft)",
      "--professional-badge-fg": "var(--text-muted)",
    } as CSSProperties;
  }
  const a = 0.14;
  const bg = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
  const bd = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.38)`;
  const bb = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`;
  return {
    "--professional-bg": bg,
    "--professional-border": bd,
    "--professional-badge-bg": bb,
    "--professional-badge-fg": "var(--text)",
  } as CSSProperties;
}
