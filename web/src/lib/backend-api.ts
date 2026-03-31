const DEFAULT_BACKEND_URL = "http://localhost:3001";

export function getBackendApiBaseUrl() {
  return (process.env.BACKEND_API_URL ?? process.env.NEXT_PUBLIC_BACKEND_API_URL ?? DEFAULT_BACKEND_URL).replace(/\/$/, "");
}

export async function proxyToBackend(path: string, init?: RequestInit) {
  const baseUrl = getBackendApiBaseUrl();
  const url = `${baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const payload = {
      error: "BACKEND_UNREACHABLE",
      message:
        `O backend Express não respondeu em ${baseUrl}. Inicie-o na raiz do projeto com: npm run dev:backend (ou npm run dev:all em paralelo com o Next). Se quiser subir apenas o frontend, use npm run dev:frontend. Ajuste BACKEND_API_URL em web/.env.local se usar outra URL ou porta.`,
      ...(process.env.NODE_ENV === "development" ? { details: detail } : {}),
    };

    return new Response(JSON.stringify(payload), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
