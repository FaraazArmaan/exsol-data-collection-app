// Marketing module FE API wrappers. Mirrors src/modules/crm/api.ts (throwing style).
// All endpoints are auth-gated (cookie credentials included).

export class MarketingApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly details?: unknown) {
    super(code);
    this.name = 'MarketingApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    let code = 'unknown';
    let details: unknown;
    try { const body = await res.json(); code = body?.error?.code ?? code; details = body?.error?.details; } catch { /* noop */ }
    throw new MarketingApiError(res.status, code, details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// ---------- Types ----------

export type Audience = 'all' | 'recent_30d';

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  body_html?: string;
  audience: Audience;
  status: 'draft' | 'sent';
  sent_at: string | null;
  created_at: string;
}

export interface CampaignSend {
  id: string;
  recipient_email: string;
  status: 'sent' | 'logged' | 'failed';
  provider_id: string | null;
  error: string | null;
  created_at: string;
}

export interface CampaignDetail {
  campaign: Campaign;
  sends: CampaignSend[];
}

export interface AudienceCount {
  audience: Audience;
  count: number;
}

// ---------- API ----------

export const marketingApi = {
  listCampaigns: () => call<{ campaigns: Campaign[] }>('/api/marketing/campaigns'),
  getCampaign: (id: string) => call<CampaignDetail>(`/api/marketing/campaigns/${id}`),
  createCampaign: (body: { name: string; subject: string; body_html: string; audience: Audience }) =>
    call<{ campaign: Campaign }>('/api/marketing/campaigns', json('POST', body)),
  audienceCount: (audience: Audience) =>
    call<AudienceCount>(`/api/marketing/audience-count?audience=${audience}`),
  send: (campaign_id: string) =>
    call<{ sent: number; byStatus: Record<string, number> }>('/api/marketing/send', json('POST', { campaign_id })),
};
