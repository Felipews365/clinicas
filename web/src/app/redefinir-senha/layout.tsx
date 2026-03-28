import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Nova senha — Consultório",
  description: "Defina uma nova senha para a sua conta.",
};

export default function RedefinirSenhaLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
