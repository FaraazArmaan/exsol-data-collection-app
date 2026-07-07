import { describe, it, expect } from 'vitest';
import { dispatch, channelContact, isSendChannel, SEND_CHANNELS } from '../../src/modules/marketing/lib/channels';

const msg = { to: 'x@y.com', from: 'f@z.com', subject: 'Hi', html: '<p>h</p>' };

describe('channel dispatch seam', () => {
  it('email delegates to deliverEmail and maps delivery result → status', async () => {
    const sent = await dispatch('email', msg, { deliverEmail: async () => ({ ok: true, delivered: true, providerId: 'p1' }) });
    expect(sent).toEqual({ status: 'sent', providerId: 'p1', error: undefined });

    const logged = await dispatch('email', msg, { deliverEmail: async () => ({ ok: true, delivered: false }) });
    expect(logged.status).toBe('logged');

    const failed = await dispatch('email', msg, { deliverEmail: async () => ({ ok: false, delivered: false, error: 'boom' }) });
    expect(failed).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('email without a transport falls back to logged (dev/CI)', async () => {
    expect((await dispatch('email', msg)).status).toBe('logged');
  });

  it('sms/whatsapp/social are mock seams that log-and-succeed', async () => {
    for (const ch of ['sms', 'whatsapp', 'social'] as const) {
      expect((await dispatch(ch, msg)).status).toBe('logged');
    }
  });

  it('channelContact maps channel → required contact field', () => {
    expect(channelContact('email')).toBe('email');
    expect(channelContact('sms')).toBe('phone');
    expect(channelContact('whatsapp')).toBe('phone');
    expect(channelContact('social')).toBe('none');
  });

  it('isSendChannel accepts per-recipient channels only (social is scheduler-owned)', () => {
    expect(SEND_CHANNELS).toEqual(['email', 'sms', 'whatsapp']);
    expect(isSendChannel('sms')).toBe(true);
    expect(isSendChannel('social')).toBe(false);
    expect(isSendChannel('nope')).toBe(false);
    expect(isSendChannel(undefined)).toBe(false);
  });
});
