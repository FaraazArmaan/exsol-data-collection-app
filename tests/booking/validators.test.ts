import { describe, it, expect } from 'vitest';
import { SettingsPut, ServiceCreate, ServicePatch, PublicCreateBody } from '../../netlify/functions/_booking-validators';

describe('booking validators', () => {
  it('SettingsPut accepts a weekly schedule + interval', () => {
    expect(SettingsPut.parse({
      slot_interval_min: 15, lead_time_min: 0, cancel_cutoff_min: 60,
      weekly_schedule: { mon: [{ open: '09:00', close: '18:00' }] }, date_overrides: [],
    }).slot_interval_min).toBe(15);
  });

  it('ServiceCreate requires deposit_cents when payment_mode is deposit', () => {
    expect(() => ServiceCreate.parse({ name: 'Color', duration_min: 60, price_cents: 50000, payment_mode: 'deposit' })).toThrow();
    expect(ServiceCreate.parse({ name: 'Color', duration_min: 60, price_cents: 50000, payment_mode: 'deposit', deposit_cents: 10000 }).deposit_cents).toBe(10000);
  });

  it('ServiceCreate applies pay_at_venue + 0 buffer defaults', () => {
    const s = ServiceCreate.parse({ name: 'Cut', duration_min: 30, price_cents: 20000 });
    expect(s.payment_mode).toBe('pay_at_venue');
    expect(s.buffer_min).toBe(0);
  });

  it('ServicePatch leaves omitted fields undefined (no default reset)', () => {
    const p = ServicePatch.parse({ name: 'Renamed' });
    expect(p.name).toBe('Renamed');
    expect(p.buffer_min).toBeUndefined();
    expect(p.payment_mode).toBeUndefined();
  });

  it('PublicCreateBody requires service, start, customer; accepts "any"', () => {
    const ok = PublicCreateBody.parse({
      service_id: crypto.randomUUID(), resource_id: 'any',
      start: '2026-08-17T09:00:00.000Z', customer: { name: 'Riya', phone: '98765 43210' },
    });
    expect(ok.resource_id).toBe('any');
  });
});
