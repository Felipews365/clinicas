import { AgendaPortal } from "@/components/agenda-portal";
import { PainelQueryProvider } from "@/components/painel-query-provider";

export default function PainelPage() {
  return (
    <PainelQueryProvider>
      <div className="min-h-full flex-1 bg-[var(--bg)] transition-colors duration-300">
        <AgendaPortal />
      </div>
    </PainelQueryProvider>
  );
}
