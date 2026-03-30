import type { SupabaseClient } from "@supabase/supabase-js";

export const PROFESSIONAL_AVATAR_BUCKET = "professional-avatars";

/** Curadoria para “fallback” visual antes das iniciais. */
export const PROFESSIONAL_AVATAR_EMOJI_OPTIONS = [
  "👩‍⚕️",
  "👨‍⚕️",
  "🧑‍⚕️",
  "🦷",
  "💆",
  "🧠",
  "💅",
  "✨",
  "🌿",
  "❤️",
  "😊",
  "🙂",
  "👤",
  "⭐",
  "🩺",
  "💊",
  "🧴",
  "🪞",
  "🌸",
  "🦋",
] as const;

export function professionalInitials(name: string | null | undefined): string {
  if (!name?.trim()) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (
      (parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "")
    ).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase();
}

export function professionalAvatarPublicUrl(
  supabase: SupabaseClient,
  path: string | null | undefined
): string | null {
  const p = path?.trim();
  if (!p) return null;
  const { data } = supabase.storage
    .from(PROFESSIONAL_AVATAR_BUCKET)
    .getPublicUrl(p);
  return data.publicUrl ?? null;
}

export function guessImageExt(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,4}$/.test(fromName)) {
    if (fromName === "jpeg") return "jpg";
    return fromName;
  }
  const t = file.type;
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  if (t === "image/gif") return "gif";
  return "jpg";
}

export function storagePathForProfessionalAvatar(
  clinicId: string,
  professionalId: string,
  ext: string
): string {
  const e = ext.replace(/^\./, "").toLowerCase() || "jpg";
  return `${clinicId}/${professionalId}.${e}`;
}
