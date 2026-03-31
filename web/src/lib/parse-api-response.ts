export type ParsedApiBody<T extends Record<string, unknown>> =
  | { parseFailed: false; resOk: boolean; status: number; data: T }
  | { parseFailed: true; resOk: boolean; status: number; data: T | null; rawPreview?: string };

export async function parseApiJson<T extends Record<string, unknown>>(
  res: Response
): Promise<ParsedApiBody<T>> {
  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  const trimmed = text.trimStart();
  const looksJson =
    contentType.includes("application/json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[");

  if (!looksJson || !trimmed) {
    return {
      parseFailed: true,
      resOk: res.ok,
      status: res.status,
      data: null,
      rawPreview: text.slice(0, 280),
    };
  }

  try {
    const data = JSON.parse(text) as T;
    return { parseFailed: false, resOk: res.ok, status: res.status, data };
  } catch {
    return {
      parseFailed: true,
      resOk: res.ok,
      status: res.status,
      data: null,
      rawPreview: text.slice(0, 280),
    };
  }
}
