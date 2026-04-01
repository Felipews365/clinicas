"use client";

import { useState } from "react";

export function AdminCopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-xs font-medium text-amber-400/90 underline-offset-2 hover:text-amber-300 hover:underline"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        });
      }}
    >
      {done ? "Copiado" : label}
    </button>
  );
}
