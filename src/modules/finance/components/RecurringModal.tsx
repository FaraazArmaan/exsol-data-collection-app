import { useState } from 'react';
import {
  FINANCE_CATEGORIES, CATEGORY_LABELS, CADENCES, CADENCE_LABELS,
  type Cadence, type FinanceCategory, type RecurringTemplate, type RecurringInput,
} from '../shared/types';
import { currencyMeta, listCurrencies } from '../../../lib/currency';
import { toMinor, fromMinor } from '../shared/money';

interface Props {
  template: RecurringTemplate | null; // null = create
  baseCurrency: string;
  defaultDate: string;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (input: RecurringInput) => void;
}

export function RecurringModal({
  template, baseCurrency, defaultDate, saving, onCancel, onSubmit,
}: Props) {
  const base = baseCurrency.toUpperCase();
  const [category, setCategory] = useState<FinanceCategory>(template?.category ?? 'rent');
  const [currency, setCurrency] = useState<string>((template?.currency ?? base).toUpperCase());
  const [amount, setAmount] = useState<string>(
    template ? fromMinor(template.amount_cents, template.currency) : '',
  );
  const [fxRate, setFxRate] = useState<string>(template ? String(template.fx_rate) : '');
  const [cadence, setCadence] = useState<Cadence>(template?.cadence ?? 'monthly');
  const [nextRun, setNextRun] = useState<string>(template?.next_run.slice(0, 10) ?? defaultDate);
  const [note, setNote] = useState<string>(template?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const isForeign = currency !== base;
  const symbol = currencyMeta(currency).symbol.trim() || currency;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount_cents = toMinor(amount, currency);
    if (!Number.isFinite(amount_cents) || amount_cents < 0) { setError('Enter a valid amount.'); return; }
    if (isForeign && !(Number(fxRate) > 0)) {
      setError(`Enter the exchange rate (1 ${currency} = ? ${base}).`); return;
    }
    if (!nextRun) { setError('Pick the first run date.'); return; }
    setError(null);
    onSubmit({
      category,
      amount_cents,
      cadence,
      next_run: nextRun,
      note: note.trim() ? note.trim() : null,
      currency,
      fx_rate: isForeign ? Number(fxRate) : undefined,
    });
  };

  return (
    <div className="fin-modal-backdrop" role="dialog" aria-modal="true" aria-label={template ? 'Edit template' : 'New recurring expense'}>
      <form className="fin-modal" onSubmit={submit}>
        <div className="fin-modal-header">{template ? 'Edit template' : 'New recurring expense'}</div>

        <div className="fin-modal-body">
          <label className="fin-field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as FinanceCategory)}>
              {FINANCE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </label>

          <div className="fin-field-row">
            <label className="fin-field fin-field-amount">
              <span>Amount ({symbol})</span>
              <input type="number" min="0" step="any" inputMode="decimal"
                value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
            </label>
            <label className="fin-field fin-field-currency">
              <span>Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())}>
                {listCurrencies().map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </label>
          </div>

          {isForeign && (
            <label className="fin-field">
              <span>Exchange rate <em className="fin-muted">(1 {currency} = ? {base})</em></span>
              <input type="number" min="0" step="any" inputMode="decimal"
                value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder={`rate to ${base}`} />
            </label>
          )}

          <div className="fin-field-row">
            <label className="fin-field fin-field-amount">
              <span>Repeats</span>
              <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
                {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABELS[c]}</option>)}
              </select>
            </label>
            <label className="fin-field fin-field-amount">
              <span>{cadence === 'once' ? 'Due date' : 'First run'}</span>
              <input type="date" value={nextRun} onChange={(e) => setNextRun(e.target.value)} />
            </label>
          </div>

          <label className="fin-field">
            <span>Note <em className="fin-muted">(optional)</em></span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500}
              placeholder="e.g. Monthly shop rent" />
          </label>

          {error && <p className="fin-form-error" role="alert">{error}</p>}
        </div>

        <div className="fin-modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : template ? 'Save changes' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
