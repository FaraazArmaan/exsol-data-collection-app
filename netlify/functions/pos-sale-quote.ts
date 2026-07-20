import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { loadPosSaleQuote, quoteResponse, signPosQuote } from './_shared/pos-sale-quote';
import { requirePos } from './_pos-authz';
import { SaleQuoteBody } from './_pos-validators';

export const config = { path: '/api/pos/sale-quote', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const auth = await requirePos(req, ['pos.sale.create']);
  if (!auth.ok) return auth.res;
  let body: SaleQuoteBody;
  try {
    body = SaleQuoteBody.parse(await req.json());
  } catch (error: any) {
    return jsonError(400, 'invalid_body', { issues: error?.issues });
  }
  const quote = await loadPosSaleQuote(db(), auth.ctx.clientId, body);
  if ('code' in quote) return jsonError(quote.status, quote.code);
  return jsonOk(quoteResponse(quote, await signPosQuote(quote, auth.ctx.clientId, auth.ctx.userNodeId)));
}
