import { useRef, useState } from 'react';
import {
  FINANCE_CATEGORIES, CATEGORY_LABELS,
  type Expense, type ExpenseInput, type FinanceCategory,
} from '../shared/types';
import { currencyMeta, listCurrencies } from '../../../lib/currency';
import { formatMoney } from '../shared/format';
import { financeApi } from '../shared/api';

const OCR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Read a File as raw base64 (strip the data-URI prefix).
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error('read_failed'));
    r.readAsDataURL(file);
  });
}

interface Props {
  expense: Expense | null;
  defaultDate: string;
  baseCurrency: string;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (input: ExpenseInput) => void;
}

// Major-unit string → integer minor units for the given currency (JPY = 0
// decimals, INR/USD = 2). '' / bad input → NaN (caught by the guard).
function toMinor(amountStr: string, currency: string): number {
  const n = Number(amountStr);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 10 ** currencyMeta(currency).decimals);
}
function fromMinor(minor: number, currency: string): string {
  return (minor / 10 ** currencyMeta(currency).decimals).toString();
}

export function ExpenseModal({
  expense, defaultDate, baseCurrency, saving, onCancel, onSubmit,
}: Props) {
  const base = baseCurrency.toUpperCase();
  const [category, setCategory] = useState<FinanceCategory>(expense?.category ?? 'supplies');
  const [currency, setCurrency] = useState<string>((expense?.currency ?? base).toUpperCase());
  const [amount, setAmount] = useState<string>(
    expense ? fromMinor(expense.amount_cents, expense.currency) : '',
  );
  const [fxRate, setFxRate] = useState<string>(expense ? String(expense.fx_rate) : '');
  const [incurredOn, setIncurredOn] = useState<string>(
    expense ? expense.incurred_on.slice(0, 10) : defaultDate,
  );
  const [note, setNote] = useState<string>(expense?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanHint, setScanHint] = useState<string | null>(null);

  const onScanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (!OCR_TYPES.includes(file.type)) {
      setError('Unsupported image — use JPEG, PNG, WebP, or GIF.');
      return;
    }
    setScanning(true); setError(null); setScanHint(null);
    try {
      const b64 = await fileToBase64(file);
      const { prefill, is_fallback } = await financeApi.ocrReceipt(b64, file.type);
      if (prefill.category) setCategory(prefill.category);
      if (prefill.currency) setCurrency(prefill.currency.toUpperCase());
      if (prefill.amount != null) setAmount(String(prefill.amount));
      if (prefill.incurred_on) setIncurredOn(prefill.incurred_on);
      if (prefill.note) setNote(prefill.note);
      setScanHint(is_fallback
        ? 'AI preview — set ANTHROPIC_API_KEY for real receipt extraction.'
        : 'Filled from the receipt — please review before saving.');
    } catch {
      setError('Could not read that receipt.');
    } finally {
      setScanning(false);
    }
  };

  const isForeign = currency !== base;
  const symbol = currencyMeta(currency).symbol.trim() || currency;

  // Live base-currency preview for foreign amounts.
  const amountNum = Number(amount);
  const rateNum = Number(fxRate);
  const basePreview = isForeign && Number.isFinite(amountNum) && rateNum > 0
    ? formatMoney(Math.round(amountNum * rateNum * 10 ** currencyMeta(base).decimals), base)
    : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount_cents = toMinor(amount, currency);
    if (!Number.isFinite(amount_cents) || amount_cents < 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (isForeign && !(rateNum > 0)) {
      setError(`Enter the exchange rate (1 ${currency} = ? ${base}).`);
      return;
    }
    if (!incurredOn) {
      setError('Pick a date.');
      return;
    }
    setError(null);
    onSubmit({
      category,
      amount_cents,
      incurred_on: incurredOn,
      note: note.trim() ? note.trim() : null,
      currency,
      fx_rate: isForeign ? rateNum : undefined,
    });
  };

  return (
    <div className="fin-modal-backdrop" role="dialog" aria-modal="true" aria-label={expense ? 'Edit expense' : 'Add expense'}>
      <form className="fin-modal" onSubmit={submit}>
        <div className="fin-modal-header">{expense ? 'Edit expense' : 'Add expense'}</div>

        <div className="fin-modal-body">
          {!expense && (
            <div className="fin-scan">
              <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={scanning}>
                {scanning ? 'Scanning…' : '📷 Scan receipt'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onScanFile} />
              {scanHint && <span className="fin-scan-hint">{scanHint}</span>}
            </div>
          )}

          <label className="fin-field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as FinanceCategory)}>
              {FINANCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </label>

          <div className="fin-field-row">
            <label className="fin-field fin-field-amount">
              <span>Amount ({symbol})</span>
              <input
                type="number" min="0" step="any" inputMode="decimal"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00" autoFocus
              />
            </label>
            <label className="fin-field fin-field-currency">
              <span>Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())}>
                {listCurrencies().map((c) => (
                  <option key={c.code} value={c.code}>{c.code}</option>
                ))}
              </select>
            </label>
          </div>

          {isForeign && (
            <label className="fin-field">
              <span>Exchange rate <em className="fin-muted">(1 {currency} = ? {base})</em></span>
              <input
                type="number" min="0" step="any" inputMode="decimal"
                value={fxRate} onChange={(e) => setFxRate(e.target.value)}
                placeholder={`e.g. rate to ${base}`}
              />
              {basePreview && <span className="fin-fx-preview">≈ {basePreview} in {base}</span>}
            </label>
          )}

          <label className="fin-field">
            <span>Date incurred</span>
            <input type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} />
          </label>

          <label className="fin-field">
            <span>Note <em className="fin-muted">(optional)</em></span>
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)}
              rows={2} maxLength={500} placeholder="What was this for?"
            />
          </label>

          {error && <p className="fin-form-error" role="alert">{error}</p>}
        </div>

        <div className="fin-modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : expense ? 'Save changes' : 'Add expense'}
          </button>
        </div>
      </form>
    </div>
  );
}
