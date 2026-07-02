import { useState } from 'react';
import {
  FINANCE_CATEGORIES, CATEGORY_LABELS,
  type Expense, type ExpenseInput, type FinanceCategory,
} from '../shared/types';

interface Props {
  // The expense being edited, or null for a fresh create.
  expense: Expense | null;
  // Default date for a new expense (first of the selected month, or today).
  defaultDate: string;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (input: ExpenseInput) => void;
}

// Rupees string → integer cents. '' / bad input → NaN (caught by the guard).
function toCents(rupees: string): number {
  const n = Number(rupees);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export function ExpenseModal({ expense, defaultDate, saving, onCancel, onSubmit }: Props) {
  const [category, setCategory] = useState<FinanceCategory>(expense?.category ?? 'supplies');
  const [amount, setAmount] = useState<string>(
    expense ? (expense.amount_cents / 100).toString() : '',
  );
  const [incurredOn, setIncurredOn] = useState<string>(
    expense ? expense.incurred_on.slice(0, 10) : defaultDate,
  );
  const [note, setNote] = useState<string>(expense?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount_cents = toCents(amount);
    if (!Number.isFinite(amount_cents) || amount_cents < 0) {
      setError('Enter a valid amount (₹0 or more).');
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
    });
  };

  return (
    <div className="fin-modal-backdrop" role="dialog" aria-modal="true" aria-label={expense ? 'Edit expense' : 'Add expense'}>
      <form className="fin-modal" onSubmit={submit}>
        <div className="fin-modal-header">{expense ? 'Edit expense' : 'Add expense'}</div>

        <div className="fin-modal-body">
          <label className="fin-field">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as FinanceCategory)}>
              {FINANCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </label>

          <label className="fin-field">
            <span>Amount (₹)</span>
            <input
              type="number" min="0" step="0.01" inputMode="decimal"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00" autoFocus
            />
          </label>

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
