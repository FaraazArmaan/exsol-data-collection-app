import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the shared AI seam so receipt extraction is deterministic (no live vision
// call). The real seam is exercised by finance-ai-insights.test.ts.
vi.mock('../../netlify/functions/_shared/ai', () => ({ ask: vi.fn() }));

import { ask } from '../../netlify/functions/_shared/ai';
import ocrHandler from '../../netlify/functions/finance-ocr-receipt';
import { seedFinanceClient, seedClientWithProductsEnabled, makeBucketUserRequest } from './_helpers';

const mockAsk = vi.mocked(ask);
const TINY_B64 = 'aGVsbG8='; // "hello"

function ocrReq(ctx: any, body: any) {
  return makeBucketUserRequest(ctx, 'POST', '/api/finance/ocr-receipt', body);
}

describe('finance-ocr-receipt', () => {
  beforeEach(() => mockAsk.mockReset());

  it('maps a receipt image to prefilled expense fields', async () => {
    mockAsk.mockResolvedValue({
      text: JSON.stringify({ vendor: 'Cafe Bloom', amount: 12.5, currency: 'USD', category: 'supplies', date: '2026-07-01' }),
      model: 'test', fallback: false,
    });
    const ctx = await seedFinanceClient();
    const res = await ocrHandler(ocrReq(ctx, { image_base64: TINY_B64, media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.is_fallback).toBe(false);
    expect(b.prefill.category).toBe('supplies');
    expect(b.prefill.currency).toBe('USD');
    expect(b.prefill.amount).toBe(12.5);
    expect(b.prefill.incurred_on).toBe('2026-07-01');
    expect(b.prefill.note).toBe('Cafe Bloom');
  });

  it('drops invalid fields (unknown category / currency / bad date / negative amount)', async () => {
    mockAsk.mockResolvedValue({
      text: JSON.stringify({ vendor: 'X', amount: -5, currency: 'ZZZ', category: 'yacht', date: 'nope' }),
      model: 'test', fallback: false,
    });
    const ctx = await seedFinanceClient();
    const b = await (await ocrHandler(ocrReq(ctx, { image_base64: TINY_B64, media_type: 'image/png' }))).json() as any;
    expect(b.prefill.category).toBe(null);
    expect(b.prefill.currency).toBe(null);
    expect(b.prefill.amount).toBe(null);
    expect(b.prefill.incurred_on).toBe(null);
  });

  it('returns an empty prefill when the AI seam is in fallback (no key)', async () => {
    mockAsk.mockResolvedValue({ text: '[AI preview …]', model: 'dev-fallback', fallback: true });
    const ctx = await seedFinanceClient();
    const b = await (await ocrHandler(ocrReq(ctx, { image_base64: TINY_B64, media_type: 'image/webp' }))).json() as any;
    expect(b.is_fallback).toBe(true);
    expect(b.prefill.amount).toBe(null);
  });

  it('degrades to an empty prefill on non-JSON model output (no 500)', async () => {
    mockAsk.mockResolvedValue({ text: 'Sorry, I cannot read this.', model: 'test', fallback: false });
    const ctx = await seedFinanceClient();
    const res = await ocrHandler(ocrReq(ctx, { image_base64: TINY_B64, media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.prefill.amount).toBe(null);
  });

  it('rejects an unsupported media type (400)', async () => {
    const ctx = await seedFinanceClient();
    const res = await ocrHandler(ocrReq(ctx, { image_base64: TINY_B64, media_type: 'image/tiff' }));
    expect(res.status).toBe(400);
  });

  it('returns 412 when the finance module is not enabled', async () => {
    const noFin = await seedClientWithProductsEnabled();
    const res = await ocrHandler(ocrReq(noFin, { image_base64: TINY_B64, media_type: 'image/jpeg' }));
    expect(res.status).toBe(412);
  });
});
