import { describe, it, expect } from 'vitest';
import {
  renderBookingConfirmation, renderStorefrontReceipt, renderOrderHandoff,
} from '../../netlify/functions/_shared/email-templates';
import type { EmailBrand } from '../../netlify/functions/_shared/brand-email';

const brand: EmailBrand = {
  name: "Papa's Saloon", slug: 'papa-s-saloon', accent: '#c0392b', theme: 'light',
  fontHeading: null, fontBody: null, logoUrl: null,
};

describe('renderBookingConfirmation', () => {
  it('produces subject, branded html, and a valid ics', () => {
    const r = renderBookingConfirmation(brand, {
      customerName: 'Ada', serviceName: 'Haircut',
      startIso: '2026-07-10T09:00:00.000Z', endIso: '2026-07-10T09:30:00.000Z',
      priceCents: 25000, uid: 'abc@exsol',
    });
    expect(r.subject).toContain('Haircut');
    expect(r.subject).toContain("Papa's Saloon");
    expect(r.html).toContain('Booking confirmed');
    expect(r.html).toContain('Haircut');
    expect(r.html).toContain('₹250.00');
    expect(r.ics).toContain('BEGIN:VCALENDAR');
    expect(r.ics).toContain('UID:abc@exsol');
    expect(r.ics).toContain('SUMMARY:Haircut');
  });

  it('escapes customer-supplied HTML (no XSS in the body)', () => {
    const r = renderBookingConfirmation(brand, {
      customerName: '<script>alert(1)</script>', serviceName: 'Cut',
      startIso: '2026-07-10T09:00:00.000Z', endIso: '2026-07-10T09:30:00.000Z', uid: 'x@exsol',
    });
    expect(r.html).not.toContain('<script>alert(1)</script>');
    expect(r.html).toContain('&lt;script&gt;');
  });

  it('sanitizes a hostile brand accent so it cannot break out of the style attr', () => {
    const evil: EmailBrand = { ...brand, accent: 'red;left:0"><script>x</script>' };
    const r = renderBookingConfirmation(evil, {
      customerName: 'Ada', serviceName: 'Cut',
      startIso: '2026-07-10T09:00:00.000Z', endIso: '2026-07-10T09:30:00.000Z', uid: 'y@exsol',
    });
    expect(r.html).not.toContain('<script>x</script>');
  });
});

describe('renderOrderHandoff', () => {
  it('renders a tracking-safe shipped notice without customer HTML injection', () => {
    const r = renderOrderHandoff(brand, { customerName: '<img>', orderNo: 73, event: 'shipped', carrier: 'DHL', trackingRef: 'DHL-73' });
    expect(r.subject).toContain('#73');
    expect(r.html).toContain('Order shipped');
    expect(r.html).toContain('DHL-73');
    expect(r.html).toContain('&lt;img&gt;');
  });
});

describe('renderStorefrontReceipt', () => {
  it('lists line items and total', () => {
    const r = renderStorefrontReceipt(brand, {
      customerName: 'Bo', orderNo: 42,
      lines: [
        { productName: 'Shampoo', qty: 2, unitPriceCents: 15000, lineTotalCents: 30000 },
        { productName: 'Comb', qty: 1, unitPriceCents: 5000, lineTotalCents: 5000 },
      ],
      subtotalCents: 35000, totalCents: 35000,
    });
    expect(r.subject).toContain('#42');
    expect(r.html).toContain('Order received');
    expect(r.html).toContain('Shampoo');
    expect(r.html).toContain('× 2');
    expect(r.html).toContain('₹350.00');
  });
});
