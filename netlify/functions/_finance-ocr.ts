// Receipt OCR — sends an uploaded receipt image to the ai.ts vision seam and
// maps the extracted fields onto the expense form. Every field is validated /
// clamped to what the form accepts (known category, supported currency, ISO
// date). Without ANTHROPIC_API_KEY the seam returns the dev fallback → we return
// an empty prefill (is_fallback: true) so the user just fills the form manually.
import { ask, type AskImageMediaType } from './_shared/ai';
import { isSupportedCurrency } from '../../src/lib/currency';
import { FINANCE_CATEGORIES } from './_finance-validators';

export interface ReceiptPrefill {
  category: string | null;
  amount: number | null;      // major units, in `currency`
  currency: string | null;    // supported ISO code, else null
  incurred_on: string | null; // 'YYYY-MM-DD'
  note: string | null;        // vendor name
}

const EMPTY: ReceiptPrefill = {
  category: null, amount: null, currency: null, incurred_on: null, note: null,
};

export async function extractReceipt(
  imageBase64: string,
  mediaType: AskImageMediaType,
): Promise<{ prefill: ReceiptPrefill; is_fallback: boolean }> {
  const result = await ask({
    system: 'You extract expense fields from a receipt image. Respond with ONLY minified JSON '
      + 'of shape {"vendor":string|null,"amount":number|null,"currency":string|null,'
      + '"category":string|null,"date":string|null}. category MUST be one of: '
      + 'rent, utilities, supplies, salaries, marketing, equipment, maintenance, other. '
      + 'date MUST be YYYY-MM-DD. currency is a 3-letter ISO code. No markdown.',
    prompt: 'Extract the vendor, total amount, currency, best-fit category, and date from this receipt.',
    images: [{ mediaType, dataBase64: imageBase64 }],
    maxTokens: 400,
  });

  if (result.fallback) return { prefill: { ...EMPTY }, is_fallback: true };

  try {
    const p = JSON.parse(result.text);
    const category = typeof p.category === 'string'
      && (FINANCE_CATEGORIES as readonly string[]).includes(p.category) ? p.category : null;
    const currency = typeof p.currency === 'string' && isSupportedCurrency(p.currency)
      ? p.currency.toUpperCase() : null;
    const amount = typeof p.amount === 'number' && Number.isFinite(p.amount) && p.amount >= 0
      ? p.amount : null;
    const incurred_on = typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
      ? p.date : null;
    const note = typeof p.vendor === 'string' && p.vendor.trim()
      ? p.vendor.trim().slice(0, 200) : null;
    return { prefill: { category, amount, currency, incurred_on, note }, is_fallback: false };
  } catch {
    // Model returned non-JSON — degrade to a manual entry rather than 500.
    return { prefill: { ...EMPTY }, is_fallback: false };
  }
}
