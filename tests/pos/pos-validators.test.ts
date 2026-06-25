import { describe, it, expect } from 'vitest';
import { SaleCreateBody, SaleStateBody, SalesListQuery } from '../../netlify/functions/_pos-validators';

describe('SaleCreateBody', () => {
  const valid = {
    channel: 'instore', idempotencyKey: 'a'.repeat(20),
    customer: { name: 'R', phone: '9' },
    lines: [{ productId: '00000000-0000-0000-0000-000000000001', qty: 1 }],
  };
  it('accepts a valid body', () => expect(() => SaleCreateBody.parse(valid)).not.toThrow());
  it('rejects empty lines', () => expect(() => SaleCreateBody.parse({ ...valid, lines: [] })).toThrow());
  it('rejects qty <= 0', () => expect(() => SaleCreateBody.parse({
    ...valid, lines: [{ productId: valid.lines[0]!.productId, qty: 0 }],
  })).toThrow());
  it('rejects blank phone', () => expect(() => SaleCreateBody.parse({
    ...valid, customer: { name: 'R', phone: '   ' },
  })).toThrow());
  it('rejects non-uuid productId', () => expect(() => SaleCreateBody.parse({
    ...valid, lines: [{ productId: 'not-a-uuid', qty: 1 }],
  })).toThrow());
});

describe('SaleStateBody', () => {
  it.each(['markPaid','fulfill','cancel','refund'] as const)('accepts %s', (a) =>
    expect(() => SaleStateBody.parse({ action: a })).not.toThrow());
  it('rejects unknown action', () =>
    expect(() => SaleStateBody.parse({ action: 'zorp' })).toThrow());
  it('rejects unknown paymentMethod', () =>
    expect(() => SaleStateBody.parse({ action: 'markPaid', paymentMethod: 'crypto' })).toThrow());
});

describe('SalesListQuery', () => {
  it('parses CSV status', () => {
    const q = SalesListQuery.parse({ status: 'paid,fulfilled' });
    expect(q.status).toEqual(['paid', 'fulfilled']);
  });
  it('defaults date range to today when both omitted', () => {
    const q = SalesListQuery.parse({});
    expect(q.from).toBeDefined();
    expect(q.to).toBeDefined();
  });
  it('parses single-value status (no comma)', () => {
    const q = SalesListQuery.parse({ status: 'paid' });
    expect(q.status).toEqual(['paid']);
  });
  it('rejects bad enum in CSV', () => {
    expect(() => SalesListQuery.parse({ status: 'paid,zorp' })).toThrow();
  });
  it('coerces limit to a number', () => {
    const q = SalesListQuery.parse({ limit: '25' });
    expect(q.limit).toBe(25);
  });
});
