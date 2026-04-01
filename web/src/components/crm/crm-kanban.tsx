"use client";

import type { ReactNode } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { normalizeFunil } from "@/components/crm/funil-badges";
import type { PacienteRow } from "@/components/crm/patient-drawer";
import type { CrmFunilStatus } from "@/lib/crm-funil";
import { CRM_FUNIL_STATUS } from "@/lib/crm-funil";

const COL_TITLE: Record<CrmFunilStatus, string> = {
  lead: "Lead",
  agendado: "Agendado",
  atendido: "Atendido",
  inativo: "Inactivo",
  sumido: "Sumido",
};

function KanbanCard({
  id,
  p,
  onOpen,
}: {
  id: string;
  p: PacienteRow;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: { patient: p },
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="cursor-grab rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 shadow-sm active:cursor-grabbing"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className="w-full text-left"
      >
        <p className="font-medium text-[var(--text)]">{p.nome ?? "—"}</p>
        <p className="text-xs text-[var(--text-muted)]">{p.telefone ?? "—"}</p>
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
          Última: {p.ultima_consulta ?? "—"}
        </p>
      </button>
    </div>
  );
}

function KanbanColumn({
  status,
  children,
}: {
  status: CrmFunilStatus;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-[280px] shrink-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 ${
        isOver ? "ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--bg)]" : ""
      }`}
    >
      <h3 className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {COL_TITLE[status]}
      </h3>
      <div className="flex min-h-[120px] flex-col gap-2">{children}</div>
    </div>
  );
}

type Props = {
  pacientes: PacienteRow[];
  canEdit: boolean;
  onPatchFunil: (clienteId: string, status_funil: CrmFunilStatus) => Promise<boolean>;
  onOpenPatient: (p: PacienteRow) => void;
};

export function CrmKanban({ pacientes, canEdit, onPatchFunil, onOpenPatient }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !canEdit) return;
    const pid = String(active.id);
    const newCol = over.id as CrmFunilStatus;
    if (!CRM_FUNIL_STATUS.includes(newCol)) return;
    const p = pacientes.find((x) => x.id === pid);
    if (!p || normalizeFunil(p.status_funil) === newCol) return;
    await onPatchFunil(pid, newCol);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={(e) => void handleDragEnd(e)}>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-4">
          {CRM_FUNIL_STATUS.map((status) => {
            const col = pacientes.filter((x) => normalizeFunil(x.status_funil) === status);
            return (
              <KanbanColumn key={status} status={status}>
                {col.map((p) => (
                  <KanbanCard
                    key={p.id}
                    id={p.id}
                    p={p}
                    onOpen={() => onOpenPatient(p)}
                  />
                ))}
              </KanbanColumn>
            );
          })}
        </div>
      </div>
      {!canEdit ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">Arrastar colunas: apenas dono ou administrador.</p>
      ) : null}
    </DndContext>
  );
}
