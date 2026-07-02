// Throw-on-error API client for the Email/Notifications module. Mirrors the
// pattern in src/modules/products/shared/api.ts.
import type { OutboxRow } from './types';

export class EmailApiError extends Error {
  constructor(public status: number, public code: string, public detail: unknown) {
    super(`${code} (${status})`);
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (body as { error?: { code?: string } } | null)?.error;
    throw new EmailApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

export const emailApi = {
  listOutbox: (): Promise<{ emails: OutboxRow[] }> => jsonFetch('/api/email/outbox'),
};
