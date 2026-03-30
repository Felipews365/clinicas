"use client";

import type { CSSProperties } from "react";
import { resolveProfessionalCardStyle } from "@/lib/professional-palette";
import { professionalInitials } from "@/lib/professional-avatar";

const sizeClass: Record<"sm" | "md" | "lg", string> = {
  sm: "h-9 w-9 text-[11px]",
  md: "h-11 w-11 text-sm",
  lg: "h-16 w-16 text-lg",
};

const emojiClass: Record<"sm" | "md" | "lg", string> = {
  sm: "text-base",
  md: "text-xl",
  lg: "text-3xl",
};

export type ProfessionalAvatarProps = {
  name: string;
  /** URL pública completa (ex.: getPublicUrl); tem prioridade sobre emoji e iniciais. */
  photoUrl?: string | null;
  emoji?: string | null;
  panelColor?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

/**
 * Avatar do profissional: foto → emoji → iniciais (sobre fundo da paleta).
 */
export function ProfessionalAvatar({
  name,
  photoUrl,
  emoji,
  panelColor,
  size = "md",
  className = "",
}: ProfessionalAvatarProps) {
  const preview = resolveProfessionalCardStyle(panelColor ?? null, name);
  const initials = professionalInitials(name);
  const ringStyle = {
    background: preview.lightBg,
    borderColor: preview.lightBorder,
    color: preview.accent,
  } as CSSProperties;

  const base = `inline-flex shrink-0 items-center justify-center rounded-full border-2 font-bold tabular-nums shadow-sm overflow-hidden ${sizeClass[size]} ${className}`;

  if (photoUrl) {
    return (
      <span className={`${base} border-[var(--border)] bg-[var(--surface)] p-0`}>
        <img
          src={photoUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </span>
    );
  }

  if (emoji?.trim()) {
    return (
      <span
        className={`${base} ${emojiClass[size]}`}
        style={ringStyle}
        aria-hidden
      >
        {emoji.trim()}
      </span>
    );
  }

  return (
    <span
      className={base}
      style={ringStyle}
      aria-hidden
    >
      {initials}
    </span>
  );
}
