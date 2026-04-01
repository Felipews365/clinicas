"use client";

import { useCallback, useEffect, useState } from "react";

type Fields = {
  tipo_plano: string;
  data_expiracao: string | null;
  inadimplente: boolean;
  ativo: boolean;
  numero_clinica: string | null;
};

type Props = {
  clinicId: string;
};

export function ClinicSubscriptionPanel({ clinicId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [fields, setFields] = useState<Fields | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clinica/${encodeURIComponent(clinicId)}/assinatura`, {
        credentials: "same-origin",
      });
      const json = (await res.json().catch(() => ({}))) as {
        fields?: Fields;
        canEdit?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(json.message ?? json.error ?? `Erro ${res.status}`);
        setFields(null);
        return;
      }
      if (!json.fields) {
        setError("Resposta inválida.");
        setFields(null);
        return;
      }
      setFields(json.fields);
      setCanEdit(!!json.canEdit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar.");
      setFields(null);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (!fields || !canEdit) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/clinica/${encodeURIComponent(clinicId)}/assinatura`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_plano: fields.tipo_plano,
          data_expiracao: fields.data_expiracao,
          inadimplente: fields.inadimplente,
          ativo: fields.ativo,
          numero_clinica: fields.numero_clinica,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(json.message ?? json.error ?? `Erro ${res.status}`);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao guardar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#e4ddd3] bg-[linear-gradient(180deg,#fffdf9_0%,#f8f4ec_100%)] p-8 text-sm text-[#5c534c]">
        A carregar…
      </div>
    );
  }

  if (!fields) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/80 p-6 text-sm text-red-800">
        {error ?? "Sem dados."}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-6 rounded-2xl border border-[#e4ddd3] bg-[linear-gradient(180deg,#fffdf9_0%,#f8f4ec_100%)] p-6 shadow-sm">
      <div>
        <h2 className="font-display text-lg font-semibold text-[#1f1c1a]">Assinatura e acesso</h2>
        <p className="mt-1 text-sm text-[#5c534c]">
          Campos usados pelo fluxo WhatsApp (n8n) para plano trial/mensal, bloqueios e desambiguação
          do número da clínica. A instância Evolution continua a ser{" "}
          <code className="rounded bg-[#f0ebe3] px-1 text-xs">{"clinica-{uuid}"}</code> ao conectar no
          painel.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}

      {!canEdit ? (
        <p className="text-sm text-[#7a7269]">
          Apenas dono ou administrador pode editar. Consulta reservada ao estado atual.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-[#1f1c1a]">Tipo de plano</span>
          <select
            disabled={!canEdit}
            value={fields.tipo_plano === "mensal" ? "mensal" : "teste"}
            onChange={(e) =>
              setFields((f) => (f ? { ...f, tipo_plano: e.target.value } : f))
            }
            className="rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-[#1f1c1a] disabled:opacity-60"
          >
            <option value="teste">Teste</option>
            <option value="mensal">Mensal</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-[#1f1c1a]">Data de expiração</span>
          <input
            type="date"
            disabled={!canEdit}
            value={fields.data_expiracao ?? ""}
            onChange={(e) =>
              setFields((f) =>
                f ? { ...f, data_expiracao: e.target.value || null } : f
              )
            }
            className="rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-[#1f1c1a] disabled:opacity-60"
          />
          <span className="text-xs text-[#7a7269]">Fim do trial ou do período pago.</span>
        </label>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={fields.inadimplente}
            onChange={(e) =>
              setFields((f) => (f ? { ...f, inadimplente: e.target.checked } : f))
            }
            className="h-4 w-4 rounded border-[#c9c2b8] text-[#b45309] disabled:opacity-60"
          />
          <span className="font-medium text-[#1f1c1a]">Inadimplente (bloqueia plano mensal no bot)</span>
        </label>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={fields.ativo}
            onChange={(e) =>
              setFields((f) => (f ? { ...f, ativo: e.target.checked } : f))
            }
            className="h-4 w-4 rounded border-[#c9c2b8] text-[#b45309] disabled:opacity-60"
          />
          <span className="font-medium text-[#1f1c1a]">Clínica ativa (desmarque para bloquear atendimento automático)</span>
        </label>

        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="font-medium text-[#1f1c1a]">Número da clínica (opcional)</span>
          <input
            type="text"
            disabled={!canEdit}
            placeholder="Apenas dígitos, ex.: código interno ou telefone"
            value={fields.numero_clinica ?? ""}
            onChange={(e) =>
              setFields((f) =>
                f ? { ...f, numero_clinica: e.target.value.trim() || null } : f
              )
            }
            className="rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-[#1f1c1a] disabled:opacity-60"
          />
          <span className="text-xs text-[#7a7269]">
            Usado pelo n8n com o instance quando há ambiguidade. Deixe vazio se usa só uma clínica por
            instância.
          </span>
        </label>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-xl bg-[#1f1c1a] px-5 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            {saving ? "A guardar…" : "Guardar"}
          </button>
          {saved ? (
            <span className="text-sm font-medium text-green-800">Guardado.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
