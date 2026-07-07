// POST /api/finance/ocr-receipt — extract expense fields from a receipt image.
// Body: { image_base64 (raw base64, no data-URI), media_type }. Returns a prefill
// the Add-Expense form applies; the user always reviews before saving. Gated on
// finance.business.create (creating expenses is the point). No persistence — the
// image is used transiently for extraction (receipt-image storage is deferred).
import { jsonOk, jsonError } from './_shared/http';
import { requireFinance } from './_finance-authz';
import { OcrRequest } from './_finance-validators';
import { extractReceipt } from './_finance-ocr';

export const config = { path: '/api/finance/ocr-receipt', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const a = await requireFinance(req, ['finance.business.create']);
  if (!a.ok) return a.res;

  let body: OcrRequest;
  try {
    body = OcrRequest.parse(await req.json());
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }

  const { prefill, is_fallback } = await extractReceipt(body.image_base64, body.media_type);
  return jsonOk({ prefill, is_fallback });
}
