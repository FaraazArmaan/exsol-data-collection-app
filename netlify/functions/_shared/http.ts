export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export function jsonOk(body: Json, init?: { headers?: Record<string, string>; status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

export function jsonError(status: number, code: string, details?: unknown, headers?: Record<string, string>) {
  return new Response(
    JSON.stringify({ error: { code, message: code, details } }),
    { status, headers: { 'Content-Type': 'application/json', ...(headers ?? {}) } },
  );
}
