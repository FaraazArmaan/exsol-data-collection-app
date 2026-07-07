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
export type Channel = 'email' | 'sms' | 'whatsapp';
export const SEND_CHANNELS: readonly Channel[] = ['email', 'sms', 'whatsapp'];
export const CHANNEL_LABELS: Record<Channel, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' };

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  subject_b?: string | null;
  is_ab?: boolean;
  ab_split?: number;
  body_html?: string;
  audience: Audience;
  channel: Channel;
  status: 'draft' | 'sent';
  sent_at: string | null;
  created_at: string;
}

export interface VariantStats {
  variant: string; // 'A' | 'B' | 'all'
  sends: number;
  unique_opens: number;
  unique_clicks: number;
  open_rate: number;
  click_rate: number;
}

export interface AbReport {
  is_ab: boolean;
  subject_a: string;
  subject_b: string | null;
  ab_split: number;
  variants: VariantStats[];
}

export interface CampaignSend {
  id: string;
  channel: Channel;
  recipient_email: string | null;
  recipient_phone: string | null;
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

export interface CampaignRoiRow {
  id: string;
  name: string;
  sent_at: string | null;
  window_days: number;
  sends: number;
  attributed_orders: number;
  attributed_bookings: number;
  order_cents: number;
  booking_cents: number;
  revenue_cents: number;
}

export interface RoiTotals {
  campaigns: number;
  sends: number;
  attributed_orders: number;
  attributed_bookings: number;
  revenue_cents: number;
}

export interface RoiReport {
  campaigns: CampaignRoiRow[];
  totals: RoiTotals;
}

export interface WebhookEndpoint {
  id: string;
  label: string;
  token: string;
  active: boolean;
  created_at: string;
}

export interface WebhookTrigger {
  id: string;
  event_type: string;
  campaign_id: string;
  campaign_name: string;
  active: boolean;
}

export interface WebhookEvent {
  id: string;
  event_type: string;
  triggered_count: number;
  created_at: string;
}

export interface WebhooksReport {
  endpoints: WebhookEndpoint[];
  triggers: WebhookTrigger[];
  events: WebhookEvent[];
}

export type ConsentChannel = 'email' | 'sms' | 'whatsapp' | 'all';

export interface ConsentEntry {
  id: string;
  email: string;
  channel: ConsentChannel;
  granted: boolean;
  source: string | null;
  created_at: string;
}

export interface ErasureAffected {
  crm_customers: number;
  crm_notes: number;
  sales: number;
  bookings: number;
  campaign_sends: number;
}

export interface SocialPost {
  id: string;
  provider: 'facebook' | 'instagram' | 'x' | 'linkedin';
  content: string;
  scheduled_for: string;
  status: 'scheduled' | 'posted' | 'failed' | 'cancelled';
  posted_at?: string | null;
  provider_ref?: string | null;
  error?: string | null;
  created_at: string;
}

// ---------- API ----------

export const marketingApi = {
  listCampaigns: () => call<{ campaigns: Campaign[] }>('/api/marketing/campaigns'),
  getCampaign: (id: string) => call<CampaignDetail>(`/api/marketing/campaigns/${id}`),
  createCampaign: (body: { name: string; subject: string; body_html: string; audience: Audience; channel?: Channel; is_ab?: boolean; subject_b?: string; ab_split?: number }) =>
    call<{ campaign: Campaign }>('/api/marketing/campaigns', json('POST', body)),
  abReport: (id: string) => call<AbReport>(`/api/marketing/campaigns/${id}/ab`),
  audienceCount: (audience: Audience) =>
    call<AudienceCount>(`/api/marketing/audience-count?audience=${audience}`),
  send: (campaign_id: string) =>
    call<{ sent: number; byStatus: Record<string, number> }>('/api/marketing/send', json('POST', { campaign_id })),
  roi: () => call<RoiReport>('/api/marketing/roi'),
  webhooks: () => call<WebhooksReport>('/api/marketing/webhooks'),
  createWebhook: (label: string) => call<{ endpoint: WebhookEndpoint; secret: string }>('/api/marketing/webhooks', json('POST', { label })),
  createTrigger: (event_type: string, campaign_id: string) =>
    call<{ trigger: WebhookTrigger }>('/api/marketing/webhook-triggers', json('POST', { event_type, campaign_id })),
  deleteTrigger: (id: string) => call<void>(`/api/marketing/webhook-triggers?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  gdprExportUrl: (email: string) => `/api/marketing/gdpr/export?email=${encodeURIComponent(email)}`,
  gdprConsentHistory: (email: string) => call<{ consent: ConsentEntry[] }>(`/api/marketing/gdpr/consent?email=${encodeURIComponent(email)}`),
  recordConsent: (email: string, channel: ConsentChannel, granted: boolean, source?: string) =>
    call<{ consent: ConsentEntry }>('/api/marketing/gdpr/consent', json('POST', { email, channel, granted, source })),
  gdprErase: (email: string) => call<{ erased: boolean; email: string; affected: ErasureAffected }>('/api/marketing/gdpr/erase', json('POST', { email })),
  socialPosts: () => call<{ posts: SocialPost[] }>('/api/marketing/social-posts'),
  scheduleSocial: (provider: string, content: string, scheduled_for: string) =>
    call<{ post: SocialPost }>('/api/marketing/social-posts', json('POST', { provider, content, scheduled_for })),
  postSocialNow: (id: string) => call<{ status: string }>('/api/marketing/social-posts', json('POST', { action: 'post_now', id })),
  cancelSocial: (id: string) => call<void>(`/api/marketing/social-posts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
