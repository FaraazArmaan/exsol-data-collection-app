// Pure, dependency-free renderers for transactional email. Each returns a
// subject + branded inline-CSS HTML (email clients ignore <style>/external CSS).
// ALL interpolated user data is HTML-escaped; brand color/font go through
// css-context sanitizers so a hostile brand value can't break out of an attr.
// buildIcs is reused from the booking module (pure/server-safe).
import { buildIcs } from '../../../src/modules/booking/ics';
import type { EmailBrand } from './brand-email';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function cssColor(c: string, fallback: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback;
}
function cssFont(f: string | null, fallback: string): string {
  const safe = (f ?? '').replace(/[^A-Za-z0-9 ,_-]/g, '').trim();
  return safe ? `'${safe}', ${fallback}` : fallback;
}
function money(cents: number): string {
  return `₹${((cents ?? 0) / 100).toFixed(2)}`;
}
function whenLabel(startIso: string, endIso: string): string {
  const s = new Date(startIso); const e = new Date(endIso);
  const hhmm = (x: Date) => x.toISOString().slice(11, 16);
  return `${s.toISOString().slice(0, 10)} · ${hhmm(s)}–${hhmm(e)} UTC`;
}

function layout(brand: EmailBrand, heading: string, inner: string): string {
  const accent = cssColor(brand.accent, '#3b82f6');
  const bodyFont = cssFont(brand.fontBody, 'Arial, Helvetica, sans-serif');
  const headFont = cssFont(brand.fontHeading, bodyFont);
  const logo = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" style="max-height:40px;max-width:200px;display:block" />`
    : `<div style="font-size:20px;font-weight:700;color:#ffffff">${esc(brand.name)}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>` +
    `<body style="margin:0;background:#f4f4f5;font-family:${bodyFont}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0"><tr><td align="center">` +
      `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">` +
        `<tr><td style="background:${accent};padding:20px 28px">${logo}</td></tr>` +
        `<tr><td style="padding:28px">` +
          `<h1 style="margin:0 0 16px;font-size:20px;color:#18181b;font-family:${headFont}">${esc(heading)}</h1>` +
          inner +
        `</td></tr>` +
        `<tr><td style="padding:18px 28px;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px">Sent by ${esc(brand.name)}</td></tr>` +
      `</table>` +
    `</td></tr></table></body></html>`;
}

export interface BookingConfirmationData {
  customerName: string | null;
  serviceName: string;
  startIso: string;
  endIso: string;
  priceCents?: number;
  uid: string;
}

export function renderBookingConfirmation(
  brand: EmailBrand, d: BookingConfirmationData,
): { subject: string; html: string; ics: string } {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#71717a">${esc(label)}</td>` +
    `<td style="padding:6px 0;text-align:right;color:#18181b">${esc(value)}</td></tr>`;
  const inner =
    `<p style="margin:0 0 16px;color:#3f3f46;font-size:14px">Hi ${esc(d.customerName || 'there')}, your booking is confirmed.</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px">` +
      row('Service', d.serviceName) +
      row('When', whenLabel(d.startIso, d.endIso)) +
      (d.priceCents ? row('Price', money(d.priceCents)) : '') +
    `</table>` +
    `<p style="margin:16px 0 0;color:#71717a;font-size:13px">A calendar invite is attached.</p>`;
  const ics = buildIcs({
    uid: d.uid,
    title: `${d.serviceName} — ${brand.name}`,
    startIso: d.startIso,
    endIso: d.endIso,
  });
  return {
    subject: `Booking confirmed — ${d.serviceName} · ${brand.name}`,
    html: layout(brand, 'Booking confirmed', inner),
    ics,
  };
}

export interface ReceiptLine {
  productName: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}
export interface StorefrontReceiptData {
  customerName: string | null;
  orderNo: string | number;
  lines: ReceiptLine[];
  subtotalCents: number;
  totalCents: number;
}

export function renderStorefrontReceipt(
  brand: EmailBrand, d: StorefrontReceiptData,
): { subject: string; html: string } {
  const lineRows = d.lines.map((l) =>
    `<tr><td style="padding:6px 0;color:#18181b">${esc(l.productName)} <span style="color:#71717a">× ${esc(l.qty)}</span></td>` +
    `<td style="padding:6px 0;text-align:right;color:#18181b">${esc(money(l.lineTotalCents))}</td></tr>`).join('');
  const inner =
    `<p style="margin:0 0 16px;color:#3f3f46;font-size:14px">Hi ${esc(d.customerName || 'there')}, we've received your order.</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px">` +
      lineRows +
      `<tr><td style="padding:10px 0 0;border-top:1px solid #e4e4e7;font-weight:700;color:#18181b">Total</td>` +
      `<td style="padding:10px 0 0;border-top:1px solid #e4e4e7;text-align:right;font-weight:700;color:#18181b">${esc(money(d.totalCents))}</td></tr>` +
    `</table>` +
    `<p style="margin:16px 0 0;color:#71717a;font-size:13px">Order #${esc(d.orderNo)}</p>`;
  return {
    subject: `Order received — #${d.orderNo} · ${brand.name}`,
    html: layout(brand, 'Order received', inner),
  };
}
