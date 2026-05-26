export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

// HTTP spec says Set-Cookie responses are uncacheable, but not every
// intermediary respects that. Explicit no-store on every API response
// is belt-and-suspenders against rogue caches storing auth tokens.
const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
} as const;

export function jsonOk(body: Json, init?: { headers?: Record<string, string>; status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { ...DEFAULT_HEADERS, ...(init?.headers ?? {}) },
  });
}

export function jsonError(status: number, code: string, details?: unknown, headers?: Record<string, string>) {
  return new Response(
    JSON.stringify({ error: { code, message: code, details } }),
    { status, headers: { ...DEFAULT_HEADERS, ...(headers ?? {}) } },
  );
}
