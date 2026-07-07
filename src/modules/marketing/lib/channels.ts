// Omnichannel dispatch seam. `email` is live (delegated to the injected
// deliver() so this module stays free of server-only imports and unit-testable).
// `sms`/`whatsapp`/`social` are MOCK seams — no live provider is wired yet (real
// keys pending app approval), so they log-and-succeed, recording status 'logged'.
//
// The channel a campaign sends over decides which contact field a recipient
// needs: email → recipient_email, sms/whatsapp → recipient_phone. `social` is a
// broadcast seam (no per-recipient contact) reserved for the Social Scheduler.

export type Channel = 'email' | 'sms' | 'whatsapp' | 'social';

// Channels a campaign can be SENT over per-recipient (social is scheduler-owned).
export const SEND_CHANNELS: readonly Channel[] = ['email', 'sms', 'whatsapp'];

export function isSendChannel(v: unknown): v is Channel {
  return typeof v === 'string' && (SEND_CHANNELS as readonly string[]).includes(v);
}

/** Which recipient contact field this channel addresses. */
export function channelContact(channel: Channel): 'email' | 'phone' | 'none' {
  if (channel === 'email') return 'email';
  if (channel === 'sms' || channel === 'whatsapp') return 'phone';
  return 'none';
}

export interface ChannelMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
}

export interface ChannelResult {
  status: 'sent' | 'logged' | 'failed';
  providerId?: string;
  error?: string;
}

// Injected email transport — the shape of _shared/resend.deliver() without the
// server-only import. Absent → email also falls back to a mock 'logged'.
export interface ChannelDeps {
  deliverEmail?: (msg: ChannelMessage) => Promise<{ ok: boolean; delivered: boolean; providerId?: string; error?: string }>;
}

export async function dispatch(channel: Channel, msg: ChannelMessage, deps: ChannelDeps = {}): Promise<ChannelResult> {
  if (channel === 'email') {
    if (!deps.deliverEmail) return { status: 'logged' };
    const r = await deps.deliverEmail(msg);
    const status = r.delivered ? 'sent' : r.ok ? 'logged' : 'failed';
    return { status, providerId: r.providerId, error: r.error };
  }
  // sms | whatsapp | social — mock seam. A real integration swaps this branch for
  // a provider call (Twilio, WhatsApp Cloud API, etc.) gated on its own secret.
  return { status: 'logged' };
}
