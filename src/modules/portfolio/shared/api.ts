// Throw-on-error API client for the Brand Portfolio Site editor.
// Mirrors src/modules/email/shared/api.ts.

export class PortfolioApiError extends Error {
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
    throw new PortfolioApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

export const portfolioApi = {
  getConfig: (): Promise<{ sections: unknown; published: boolean }> =>
    jsonFetch('/api/brand-site'),
  saveConfig: (sections: unknown, published: boolean): Promise<{ sections: unknown; published: boolean }> =>
    jsonFetch('/api/brand-site', { method: 'PUT', body: JSON.stringify({ sections, published }) }),
};
