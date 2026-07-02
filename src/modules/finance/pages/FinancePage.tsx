import { useCallback, useEffect, useState } from 'react';
import '../finance.css';
import { financeApi, FinanceApiError } from '../shared/api';
import {
  CATEGORY_LABELS, type Expense, type ExpenseInput, type FinanceSummary,
} from '../shared/types';
import { currentMonth, formatCents, formatDay, monthLabel } from '../shared/format';
import { ExpenseModal } from '../components/ExpenseModal';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

type ModalState =
  | { mode: 'new' }
  | { mode: 'edit'; expense: Expense }
  | null;

const CHANNEL_LABELS: Record<string, string> = {
  pos: 'POS',
  storefront: 'Storefront',
  booking: 'Booking',
};

function humanError(e: unknown): string {
  if (e instanceof FinanceApiError) {
    if (e.status === 412) return 'The Finance module is not enabled for this workspace.';
    if (e.status === 403) return 'You don’t have permission to do that.';
    return `Something went wrong (${e.code}).`;
  }
  return 'Network error — please try again.';
}

export default function FinancePage({ perms }: Props) {
  const [month, setMonth] = useState<string>(currentMonth());
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canCreate = perms.has('finance.business.create');
  const canEdit = perms.has('finance.business.edit');
  const canDelete = perms.has('finance.business.delete');

  // Refetch P&L + expenses for a month. `spinner` controls the full-page loading
  // state — true on month change, false on a post-mutation refresh (keeps the
  // table visible while it updates).
  const fetchMonth = useCallback(async (targetMonth: string, spinner: boolean): Promise<void> => {
    if (spinner) setLoading(true);
    try {
      const [s, ex] = await Promise.all([
        financeApi.summary(targetMonth),
        financeApi.listExpenses(targetMonth),
      ]);
      setSummary(s);
      setExpenses(ex.expenses);
    } catch (e) {
      if (spinner) { setSummary(null); setExpenses(null); }
      setError(humanError(e));
    } finally {
      if (spinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([financeApi.summary(month), financeApi.listExpenses(month)])
      .then(([s, ex]) => {
        if (!alive) return;
        setSummary(s);
        setExpenses(ex.expenses);
      })
      .catch((e) => {
        if (!alive) return;
        setSummary(null);
        setExpenses(null);
        setError(humanError(e));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [month]);

  const reload = useCallback(() => fetchMonth(month, false), [fetchMonth, month]);

  const defaultDate = month === currentMonth()
    ? new Date().toISOString().slice(0, 10)
    : `${month}-01`;

  const handleSubmit = async (input: ExpenseInput) => {
    setSaving(true);
    setError(null);
    try {
      if (modal?.mode === 'edit') {
        await financeApi.updateExpense(modal.expense.id, input);
      } else {
        await financeApi.createExpense(input);
      }
      setModal(null);
      await reload();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await financeApi.removeExpense(id);
      setConfirmingId(null);
      await reload();
    } catch (e) {
      setError(humanError(e));
    } finally {
      setDeletingId(null);
    }
  };

  const channels = summary?.revenue_by_channel;
  const channelMax = channels
    ? Math.max(channels.pos, channels.storefront, channels.booking, 1)
    : 1;

  return (
    <div className="fin-shell">
      <header className="fin-header">
        <div>
          <h1 className="fin-title">Finance</h1>
          <p className="fin-subtitle">Profit &amp; loss for {monthLabel(month)}</p>
        </div>
        <label className="fin-month-picker">
          <span className="fin-muted">Month</span>
          <input
            type="month" value={month}
            max={currentMonth()}
            onChange={(e) => setMonth(e.target.value || currentMonth())}
          />
        </label>
      </header>

      {error && (
        <div className="fin-banner" role="alert">
          {error}
          <button className="fin-link" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {/* P&L summary cards */}
      <section className="fin-cards" aria-label="Profit and loss">
        <PnlCard label="Revenue" cents={summary?.revenue_cents} loading={loading} tone="revenue" />
        <PnlCard label="Expenses" cents={summary?.expenses_cents} loading={loading} tone="expense" />
        <PnlCard
          label="Net profit"
          cents={summary?.net_cents}
          loading={loading}
          tone={summary && summary.net_cents < 0 ? 'negative' : 'positive'}
        />
      </section>

      {/* Revenue by channel */}
      <section className="fin-panel" aria-label="Revenue by channel">
        <div className="fin-panel-header">Revenue by channel</div>
        {loading && <p className="fin-muted fin-pad">Loading…</p>}
        {!loading && channels && summary && summary.revenue_cents === 0 && (
          <p className="fin-empty">No revenue recorded for {monthLabel(month)} yet.</p>
        )}
        {!loading && channels && summary && summary.revenue_cents > 0 && (
          <div className="fin-bars">
            {(['pos', 'storefront', 'booking'] as const).map((k) => (
              <div className="fin-bar-row" key={k}>
                <span className="fin-bar-label">{CHANNEL_LABELS[k]}</span>
                <div className="fin-bar-track">
                  <div
                    className={`fin-bar-fill fin-bar-${k}`}
                    style={{ width: `${(channels[k] / channelMax) * 100}%` }}
                  />
                </div>
                <span className="fin-bar-value">{formatCents(channels[k])}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Expenses table */}
      <section className="fin-panel" aria-label="Expenses">
        <div className="fin-panel-header fin-panel-header-row">
          <span>Expenses</span>
          {canCreate && (
            <button className="btn btn-primary fin-add-btn" onClick={() => setModal({ mode: 'new' })}>
              + Add expense
            </button>
          )}
        </div>

        {loading && <p className="fin-muted fin-pad">Loading…</p>}

        {!loading && expenses && expenses.length === 0 && (
          <div className="fin-empty">
            <p>No expenses recorded for {monthLabel(month)}.</p>
            {canCreate && (
              <button className="btn btn-secondary" onClick={() => setModal({ mode: 'new' })}>
                Add your first expense
              </button>
            )}
          </div>
        )}

        {!loading && expenses && expenses.length > 0 && (
          <table className="fin-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Note</th>
                <th className="fin-num">Amount</th>
                {(canEdit || canDelete) && <th className="fin-actions-col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {expenses.map((ex) => (
                <tr key={ex.id}>
                  <td>{formatDay(ex.incurred_on)}</td>
                  <td><span className="fin-tag">{CATEGORY_LABELS[ex.category]}</span></td>
                  <td className="fin-note-cell">{ex.note || <span className="fin-muted">—</span>}</td>
                  <td className="fin-num">{formatCents(ex.amount_cents)}</td>
                  {(canEdit || canDelete) && (
                    <td className="fin-actions-col">
                      {confirmingId === ex.id ? (
                        <span className="fin-confirm">
                          <span className="fin-muted">Delete?</span>
                          <button
                            className="fin-link fin-danger"
                            disabled={deletingId === ex.id}
                            onClick={() => handleDelete(ex.id)}
                          >
                            {deletingId === ex.id ? '…' : 'Yes'}
                          </button>
                          <button className="fin-link" onClick={() => setConfirmingId(null)}>No</button>
                        </span>
                      ) : (
                        <span className="fin-row-actions">
                          {canEdit && (
                            <button className="fin-link" onClick={() => setModal({ mode: 'edit', expense: ex })}>
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button className="fin-link fin-danger" onClick={() => setConfirmingId(ex.id)}>
                              Delete
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {modal && (
        <ExpenseModal
          expense={modal.mode === 'edit' ? modal.expense : null}
          defaultDate={defaultDate}
          saving={saving}
          onCancel={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}

function PnlCard({
  label, cents, loading, tone,
}: { label: string; cents: number | undefined; loading: boolean; tone: string }) {
  return (
    <div className={`fin-card fin-card-${tone}`}>
      <div className="fin-card-label">{label}</div>
      <div className="fin-card-value">
        {loading || cents === undefined ? <span className="fin-skeleton" /> : formatCents(cents)}
      </div>
    </div>
  );
}
