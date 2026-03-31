"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseApiJson } from "@/lib/parse-api-response";

type WhatsappApiJson = {
  status?: string;
  qrcode?: string | null;
  webhookConfigured?: boolean;
  message?: string;
  error?: string;
};

type StatusWhatsapp =
  | "checking_config"
  | "creating_instance"
  | "configuring_webhook"
  | "waiting_qrcode"
  | "connected"
  | "disconnected"
  | "error";

type Props = {
  clinicId: string;
  supabase: SupabaseClient;
  /** Chamado quando o status muda — permite o pai atualizar UI */
  onStatusChange?: (status: StatusWhatsapp) => void;
};

export function ConectarWhatsapp({ clinicId, supabase, onStatusChange }: Props) {
  void supabase;
  const [status, setStatus] = useState<StatusWhatsapp | null>(null); // null = carregando status inicial
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [webhookConfigured, setWebhookConfigured] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const normalizeStatus = useCallback((raw?: string | null): StatusWhatsapp => {
    if (!raw) return "disconnected";
    const value = raw.toLowerCase();
    const map: Record<string, StatusWhatsapp> = {
      connected: "connected",
      conectado: "connected",
      waiting_qrcode: "waiting_qrcode",
      aguardando_qr: "waiting_qrcode",
      disconnected: "disconnected",
      desconectado: "disconnected",
      checking_config: "checking_config",
      creating_instance: "creating_instance",
      configuring_webhook: "configuring_webhook",
      error: "error",
    };
    return map[value] ?? "disconnected";
  }, []);

  const carregarStatus = useCallback(async () => {
    const res = await fetch(`/api/whatsapp/status?clinicId=${clinicId}`);
    const parsed = await parseApiJson<WhatsappApiJson>(res);
    if (parsed.parseFailed) {
      throw new Error(
        "Resposta inválida ao carregar o status. Verifique se o backend Express está em execução (npm run dev:backend ou dev:all)."
      );
    }
    if (!parsed.resOk) {
      const msg = parsed.data.message ?? "Não foi possível carregar o status.";
      throw new Error(msg);
    }
    const json = parsed.data;
    const nextStatus = normalizeStatus(json.status);
    setStatus(nextStatus);
    setMensagem(json.message ?? null);
    setWebhookConfigured(Boolean(json.webhookConfigured));
    if (json.qrcode) setQrCode(json.qrcode);
    if (nextStatus === "connected") setQrCode(null);
    onStatusChange?.(nextStatus);
  }, [clinicId, normalizeStatus, onStatusChange]);

  // ─── Carregar status inicial ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await carregarStatus();
      } catch {
        if (!cancelled) {
          setStatus("error");
          setErro("Falha ao carregar o status de conexão.");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [carregarStatus]);

  // ─── Polling: verifica status a cada 3 s ───────────────────────────────────
  const iniciarPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/whatsapp/status?clinicId=${clinicId}`);
          const parsed = await parseApiJson<WhatsappApiJson>(res);
          if (parsed.parseFailed || !parsed.resOk || !parsed.data) {
            return;
          }
          const json = parsed.data;
          const nextStatus = normalizeStatus(json.status);
          setStatus(nextStatus);
          setMensagem(json.message ?? null);
          setWebhookConfigured(Boolean(json.webhookConfigured));
          if (json.qrcode) {
            setQrCode(json.qrcode);
          }
          if (nextStatus === "connected") {
            setQrCode(null);
            onStatusChange?.("connected");
            pararPolling();
          }
          if (nextStatus === "disconnected" || nextStatus === "error") {
            onStatusChange?.(nextStatus);
          }
        } catch {
          // silencioso
        }
      })();
    }, 3000);
  }, [clinicId, normalizeStatus, onStatusChange]);

  function pararPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  function pararStepProgress() {
    if (stepProgressRef.current) {
      clearInterval(stepProgressRef.current);
      stepProgressRef.current = null;
    }
  }

  useEffect(() => () => {
    pararPolling();
    pararStepProgress();
  }, []);

  useEffect(() => {
    if (
      status === "waiting_qrcode" ||
      status === "checking_config" ||
      status === "creating_instance" ||
      status === "configuring_webhook"
    ) {
      iniciarPolling();
      return;
    }
    pararPolling();
  }, [iniciarPolling, status]);

  // ─── Clicar em "Conectar WhatsApp" ─────────────────────────────────────────
  const handleConectar = async () => {
    setCarregando(true);
    setErro(null);
    setMensagem("Validando configurações do servidor...");
    setStatus("checking_config");
    onStatusChange?.("checking_config");

    const progressSteps: StatusWhatsapp[] = [
      "checking_config",
      "creating_instance",
      "configuring_webhook",
    ];
    let idx = 0;
    pararStepProgress();
    stepProgressRef.current = setInterval(() => {
      idx = Math.min(idx + 1, progressSteps.length - 1);
      const step = progressSteps[idx];
      setStatus(step);
      onStatusChange?.(step);
      if (step === "creating_instance") {
        setMensagem("Criando ou reutilizando instância...");
      }
      if (step === "configuring_webhook") {
        setMensagem("Configurando webhook automaticamente...");
      }
    }, 900);

    try {
      const res = await fetch("/api/whatsapp/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId }),
      });
      const parsed = await parseApiJson<WhatsappApiJson>(res);
      pararStepProgress();

      if (parsed.parseFailed || !parsed.data) {
        setErro(
          "O servidor devolveu uma resposta inválida. Confirme que o backend Express está a correr e que BACKEND_API_URL em web/.env.local aponta para a porta correta (por defeito http://localhost:3001)."
        );
        setStatus("error");
        onStatusChange?.("error");
        return;
      }

      const json = parsed.data;

      if (!parsed.resOk) {
        const friendlyError =
          json.message ??
          (json.error === "BACKEND_UNREACHABLE"
            ? json.message
            : null) ??
          (json.error === "MISSING_SERVER_CONFIG"
            ? "Configuração do servidor incompleta para Evolution API."
            : "Erro ao conectar com a Evolution API.");
        setErro(typeof friendlyError === "string" ? friendlyError : "Erro ao conectar com o servidor.");
        setStatus("error");
        onStatusChange?.("error");
        return;
      }

      const nextStatus = normalizeStatus(json.status);
      setStatus(nextStatus);
      setMensagem(json.message ?? null);
      setWebhookConfigured(Boolean(json.webhookConfigured));
      if (json.qrcode) setQrCode(json.qrcode);

      if (nextStatus === "waiting_qrcode" || nextStatus === "connected" || nextStatus === "disconnected") {
        onStatusChange?.(nextStatus);
      }
      if (nextStatus !== "connected") iniciarPolling();
    } catch (e) {
      pararStepProgress();
      setStatus("error");
      const hint =
        e instanceof Error && e.message
          ? e.message
          : "Falha de rede ou tempo esgotado ao falar com o servidor. Verifique se o Next e o backend estão em execução.";
      setErro(hint);
    } finally {
      setCarregando(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      <div className="mx-auto w-full max-w-sm">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card,var(--surface))] p-6 shadow-sm">
          {/* Cabeçalho */}
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--text)]">
              Conexão WhatsApp
            </h2>
            {status !== null && <StatusBadge status={status} />}
          </div>

          {mensagem && (
            <p className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2,#f8fafc)] px-3 py-2 text-xs text-[var(--text-muted)]">
              {mensagem}
            </p>
          )}

          {/* Carregando status inicial */}
          {status === null && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}

          {/* Etapas de processamento */}
          {(status === "checking_config" ||
            status === "creating_instance" ||
            status === "configuring_webhook") && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Spinner />
              <p className="text-sm text-[var(--text-muted)]">
                {status === "checking_config" && "Verificando configurações..."}
                {status === "creating_instance" && "Criando/reutilizando instância..."}
                {status === "configuring_webhook" && "Configurando webhook..."}
              </p>
            </div>
          )}

          {/* Conectado */}
          {status === "connected" && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="text-4xl">✅</span>
              <p className="font-semibold text-[var(--text)]">
                WhatsApp conectado!
              </p>
              <p className="text-sm text-[var(--text-muted)]">
                Seu número está pronto para receber mensagens dos pacientes.
              </p>
              {webhookConfigured && (
                <p className="text-xs font-medium text-green-600 dark:text-green-400">
                  Instância e webhook configurados com sucesso.
                </p>
              )}
            </div>
          )}

          {/* Aguardando escaneamento */}
          {status === "waiting_qrcode" && (
            <div className="flex flex-col items-center gap-4">
              {qrCode ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                    alt="QR Code WhatsApp"
                    className="h-52 w-52 rounded-xl border border-[var(--border)]"
                  />
                  <p className="max-w-[220px] text-center text-sm text-[var(--text-muted)]">
                    Abra o WhatsApp &rarr;{" "}
                    <strong>Aparelhos conectados</strong> &rarr;{" "}
                    <strong>Conectar aparelho</strong>
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
                    Aguardando escaneamento…
                  </p>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-6">
                  <Spinner />
                  <p className="text-sm text-[var(--text-muted)]">
                    Aguardando QR Code…
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Desconectado — botão de conectar */}
          {status === "disconnected" && (
            <div className="flex flex-col items-center gap-4 py-2">
              <p className="text-center text-sm text-[var(--text-muted)]">
                Conecte seu número de WhatsApp para que o agente IA possa
                atender os pacientes automaticamente.
              </p>
              {erro && (
                <p className="w-full rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                  {erro}
                </p>
              )}
              <button
                onClick={() => void handleConectar()}
                disabled={carregando}
                className="flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {carregando ? (
                  <>
                    <Spinner size="sm" />
                    Gerando QR Code…
                  </>
                ) : (
                  <>
                    <WhatsAppIcon />
                    Conectar WhatsApp
                  </>
                )}
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-4 py-2">
              <p className="w-full rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                {erro ?? "Erro ao processar integração com WhatsApp."}
              </p>
              <button
                onClick={() => void handleConectar()}
                disabled={carregando}
                className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text)] hover:bg-[var(--surface-2,#f8fafc)]"
              >
                Tentar novamente
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StatusWhatsapp }) {
  const cfg: Record<StatusWhatsapp, { cor: string; label: string }> = {
    connected: { cor: "bg-green-500", label: "Conectado" },
    waiting_qrcode: { cor: "bg-yellow-400", label: "Aguardando QR" },
    disconnected: { cor: "bg-red-500", label: "Desconectado" },
    checking_config: { cor: "bg-blue-500", label: "Validando Config." },
    creating_instance: { cor: "bg-purple-500", label: "Criando Instância" },
    configuring_webhook: { cor: "bg-indigo-500", label: "Webhook" },
    error: { cor: "bg-red-700", label: "Erro" },
  };
  const { cor, label } = cfg[status];
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
      <span className={`inline-block h-2 w-2 rounded-full ${cor}`} />
      {label}
    </span>
  );
}

function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  const sz = size === "sm" ? "h-4 w-4" : "h-6 w-6";
  return (
    <svg className={`${sz} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M20.52 3.48A11.93 11.93 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.12.55 4.18 1.6 6L0 24l6.18-1.62A11.94 11.94 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.19-1.25-6.21-3.48-8.52ZM12 22c-1.85 0-3.66-.5-5.23-1.44l-.37-.22-3.88 1.02 1.04-3.8-.24-.38A9.95 9.95 0 0 1 2 12C2 6.47 6.47 2 12 2a9.95 9.95 0 0 1 7.07 2.93A9.95 9.95 0 0 1 22 12c0 5.53-4.47 10-10 10Zm5.44-7.38c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.68-1.63-.93-2.24-.24-.58-.49-.5-.68-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.01-1.04 2.47s1.07 2.87 1.22 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.27.49 1.7.63.71.22 1.36.19 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.08-.12-.28-.2-.58-.34Z" />
    </svg>
  );
}
