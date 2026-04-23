"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupportWhatsAppActivatePlanUrl } from "@/lib/support-whatsapp";

type PlanoPublic = {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  features: string[] | null;
};

type Fields = {
  plan_id: string | null;
  tipo_plano: string;
  plan_tem_crm: boolean;
  data_expiracao: string | null;
  inadimplente: boolean;
  ativo: boolean;
  numero_clinica: string | null;
  crm_reengagement_message?: string | null;
};

type Props = {
  clinicId: string;
};

type BadgeKind = "active" | "trial" | "critical";

function localMidnightFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatValidityBr(ymd: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "Sem data definida";
  const [y, m, d] = ymd.split("-");
  return `Válido até ${d}/${m}/${y}`;
}

function daysUntilExpiry(ymd: string | null): number | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const exp = localMidnightFromYmd(ymd);
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function StatusGlyph({
  kind,
  className,
}: {
  kind: "ok" | "warn" | "error" | "lock";
  className?: string;
}) {
  const cn = ["shrink-0", className].filter(Boolean).join(" ");
  switch (kind) {
    case "ok":
      return (
        <svg className={cn} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
          <path
            d="M8 12.5l2.5 2.5L16 9"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "warn":
      return (
        <svg className={cn} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 9v4M12 17h.01"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
          />
        </svg>
      );
    case "error":
      return (
        <svg className={cn} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
          <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg className={cn} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.75" />
          <path
            d="M8 11V7a4 4 0 0 1 8 0v4"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

function FeatureCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={["mt-0.5 h-4 w-4 shrink-0", className].filter(Boolean).join(" ")}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M20 6L9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ClinicSubscriptionPanel({ clinicId }: Props) {
  const [loading, setLoading] = useState(true);
  const [savingNumero, setSavingNumero] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNumero, setSavedNumero] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [fields, setFields] = useState<Fields | null>(null);
  const [planos, setPlanos] = useState<PlanoPublic[]>([]);
  const [numeroDraft, setNumeroDraft] = useState("");

  const loadPlans = useCallback(async () => {
    try {
      const res = await fetch("/api/planos", { credentials: "same-origin" });
      const j = (await res.json().catch(() => ({}))) as {
        planos?: PlanoPublic[];
      };
      if (!res.ok || !Array.isArray(j.planos)) {
        setPlanos([]);
        return;
      }
      setPlanos(j.planos);
    } catch {
      setPlanos([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadPlans();
      const assinRes = await fetch(
        `/api/clinica/${encodeURIComponent(clinicId)}/assinatura`,
        { credentials: "same-origin" }
      );
      const json = (await assinRes.json().catch(() => ({}))) as {
        fields?: Fields;
        canEdit?: boolean;
        error?: string;
        message?: string;
      };
      if (!assinRes.ok) {
        setError(json.message ?? json.error ?? `Erro ${assinRes.status}`);
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
      setNumeroDraft(json.fields.numero_clinica ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar.");
      setFields(null);
    } finally {
      setLoading(false);
    }
  }, [clinicId, loadPlans]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentPlano = useMemo(() => {
    if (!fields) return null;
    const c = fields.tipo_plano.trim().toLowerCase();
    return planos.find((p) => p.codigo.toLowerCase() === c) ?? null;
  }, [fields, planos]);

  const subscriptionUi = useMemo(() => {
    if (!fields) return null;
    const days = daysUntilExpiry(fields.data_expiracao);
    const expired = days !== null && days < 0;
    const expiringSoon = days !== null && days >= 0 && days <= 7;
    const blocked = !fields.ativo || fields.inadimplente;
    const badgeBad = blocked || expired;
    const isTeste = fields.tipo_plano.trim().toLowerCase() === "teste";

    let statusGlyph: "ok" | "warn" | "error" | "lock" = "ok";
    let statusLabel = "Ativo";
    if (!fields.ativo) {
      statusGlyph = "lock";
      statusLabel = "Bloqueado";
    } else if (fields.inadimplente) {
      statusGlyph = "lock";
      statusLabel = "Bloqueado · inadimplência";
    } else if (expired) {
      statusGlyph = "error";
      statusLabel = "Vencido";
    } else if (expiringSoon) {
      statusGlyph = "warn";
      statusLabel = "Expira em breve";
    }

    let badgeKind: BadgeKind = "active";
    let badgeLabel = "Ativo";
    if (badgeBad) {
      badgeKind = "critical";
      badgeLabel = !fields.ativo
        ? "Inativa"
        : fields.inadimplente
          ? "Inadimplente"
          : "Vencido";
    } else if (isTeste) {
      badgeKind = "trial";
      badgeLabel = "Teste";
    }

    const badgeClass =
      badgeKind === "trial"
        ? "border border-[var(--warning-border)] bg-[var(--warning-soft)] text-[var(--warning-text)]"
        : badgeKind === "critical"
          ? "border border-[var(--danger-text)]/25 bg-[var(--danger-soft)] text-[var(--danger-text)]"
          : "border border-[var(--success-text)]/30 bg-[var(--success-soft)] text-[var(--success-text)]";

    const statusColorClass =
      statusGlyph === "ok"
        ? "text-[var(--success-text)]"
        : statusGlyph === "warn"
          ? "text-[var(--warning-icon)]"
          : statusGlyph === "error"
            ? "text-[var(--danger-text)]"
            : "text-[var(--text-muted)]";

    const planTitle = currentPlano?.nome
      ? `Plano ${currentPlano.nome}`
      : `Plano ${fields.tipo_plano}`;

    const featureList =
      currentPlano?.features?.filter((f) => String(f).trim().length > 0) ?? [];

    return {
      days,
      expired,
      expiringSoon,
      blocked,
      statusGlyph,
      statusLabel,
      statusColorClass,
      showSupport: blocked || expired,
      badgeClass,
      badgeLabel,
      planTitle,
      featureList,
    };
  }, [fields, currentPlano]);

  async function handleSaveNumero() {
    if (!canEdit) return;
    setSavingNumero(true);
    setError(null);
    setSavedNumero(false);
    try {
      const res = await fetch(`/api/clinica/${encodeURIComponent(clinicId)}/assinatura`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero_clinica: numeroDraft.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setError(json.message ?? json.error ?? `Erro ${res.status}`);
        return;
      }
      setSavedNumero(true);
      setTimeout(() => setSavedNumero(false), 2500);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSavingNumero(false);
    }
  }

  if (loading) {
    return (
      <div className="agenda-animate-in rounded-2xl border border-[var(--border)] bg-[var(--color-surface)] px-6 py-12 text-center text-sm text-[var(--text-muted)] shadow-sm">
        A carregar…
      </div>
    );
  }

  if (!fields || !subscriptionUi) {
    return (
      <div
        className="rounded-2xl border px-6 py-5 text-sm shadow-sm"
        style={{
          borderColor: "var(--danger-text)",
          background: "var(--danger-soft)",
          color: "var(--danger-text)",
        }}
      >
        {error ?? "Sem dados."}
      </div>
    );
  }

  const supportUrl = getSupportWhatsAppActivatePlanUrl();

  return (
    <div className="flex min-h-0 flex-col gap-8 text-[var(--text)]">
      <header className="space-y-1">
        <h2 className="font-display text-xl font-semibold tracking-tight text-[var(--text)]">
          Assinatura e acesso
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-[var(--text-muted)]">
          Resumo do seu plano. Alterações de cobrança ou upgrade são feitas com o suporte.
        </p>
      </header>

      {error ? (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: "var(--danger-text)",
            background: "var(--danger-soft)",
            color: "var(--danger-text)",
          }}
        >
          {error}
        </div>
      ) : null}

      <section className="agenda-animate-in overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <div className="px-6 pb-2 pt-6 sm:px-8 sm:pt-8">
          <div className="flex flex-col gap-5">
            <span
              className={`inline-flex w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${subscriptionUi.badgeClass}`}
            >
              {subscriptionUi.badgeLabel}
            </span>

            <h3 className="font-display text-2xl font-bold leading-tight tracking-tight text-[var(--text)] sm:text-[1.75rem]">
              {subscriptionUi.planTitle}
            </h3>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] pb-5 text-sm">
              <span className="font-medium tabular-nums text-[var(--text)]">
                {formatValidityBr(fields.data_expiracao)}
              </span>
              <span
                className="hidden text-[var(--border)] sm:inline"
                aria-hidden
              >
                ·
              </span>
              <span
                className={`inline-flex items-center gap-2 ${subscriptionUi.statusColorClass}`}
              >
                <StatusGlyph kind={subscriptionUi.statusGlyph} className="opacity-90" />
                <span className="font-medium text-[var(--text)]">
                  {subscriptionUi.statusLabel}
                </span>
                {subscriptionUi.expiringSoon &&
                subscriptionUi.days !== null &&
                !subscriptionUi.blocked &&
                !subscriptionUi.expired ? (
                  <span className="font-normal text-[var(--text-muted)]">
                    —{" "}
                    {subscriptionUi.days === 0
                      ? "expira hoje"
                      : `faltam ${subscriptionUi.days} dia${subscriptionUi.days === 1 ? "" : "s"}`}
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-6 px-6 pb-6 sm:px-8 sm:pb-8">
          {subscriptionUi.showSupport ? (
            <div className="rounded-xl border border-[var(--danger-text)]/30 bg-[var(--danger-soft)] px-4 py-4 text-sm">
              <p className="font-medium leading-snug text-[var(--danger-text)]">
                É preciso regularizar a assinatura para manter todos os recursos disponíveis.
              </p>
              <a
                href={supportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center justify-center rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--primary-strong)]"
              >
                Falar com suporte
              </a>
            </div>
          ) : null}

          {subscriptionUi.featureList.length > 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-5 py-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Inclui no plano
              </p>
              <ul className="mt-4 space-y-3">
                {subscriptionUi.featureList.map((f, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-snug text-[var(--text)]">
                    <FeatureCheckIcon className="text-[var(--success-text)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Não há lista de benefícios configurada para este plano.
            </p>
          )}

          {currentPlano?.descricao ? (
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              {currentPlano.descricao}
            </p>
          ) : null}
        </div>
      </section>

      <section className="agenda-animate-in rounded-2xl border border-[var(--border)] bg-[var(--color-surface)] px-6 py-6 shadow-sm sm:px-8 sm:py-7">
        <div className="space-y-2">
          <label
            htmlFor="clinic-subscription-numero"
            className="block text-sm font-medium text-[var(--text)]"
          >
            Número da clínica{" "}
            <span className="font-normal text-[var(--text-muted)]">(opcional)</span>
          </label>
          <input
            id="clinic-subscription-numero"
            type="text"
            disabled={!canEdit}
            placeholder="Ex.: código interno ou telefone"
            value={numeroDraft}
            onChange={(e) => setNumeroDraft(e.target.value)}
            className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)] shadow-sm placeholder:text-[var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-50"
          />
          <p className="max-w-xl text-xs leading-relaxed text-[var(--text-muted)]">
            Usado por integrações quando a mesma instância atende várias clínicas. O plano em si é
            tratado pelo suporte.
          </p>
        </div>

        {!canEdit ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">
            Apenas dono ou administrador pode alterar este campo.
          </p>
        ) : (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSaveNumero()}
              disabled={savingNumero}
              className="rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--primary-strong)] disabled:opacity-40"
            >
              {savingNumero ? "A salvar…" : "Salvar número"}
            </button>
            {savedNumero ? (
              <span className="text-sm font-medium text-[var(--success-text)]">Salvo.</span>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
