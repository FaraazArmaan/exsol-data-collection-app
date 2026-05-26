export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) return { ok: false, error: body?.error ?? { code: 'http_error', message: `HTTP ${res.status}` } };
  return { ok: true, data: body as T };
}
