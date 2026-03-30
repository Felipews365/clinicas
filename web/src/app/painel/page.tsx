import { AgendaPortal } from "@/components/agenda-portal";

export default function PainelPage() {
  return (
    <div className="min-h-full flex-1 bg-[var(--bg)] transition-colors duration-300">
      <AgendaPortal />
    </div>
  );
}
