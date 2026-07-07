import { useEffect, useState } from 'react';
import { financeApi } from '../shared/api';
import { CATEGORY_LABELS, type Expense, type FinanceSettings } from '../shared/types';
import { formatDay, formatMoney } from '../shared/format';
import { toMinor, fromMinor } from '../shared/money';
import { humanError } from './OverviewTab';

interface Props {
  perms: ReadonlySet<string>;
}

export function ApprovalsTab({ perms }: Props) {
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [thresholdInput, setThresholdInput] = useState('');
  const [pending, setPending] = useState<Expense[] | null>(null);
  const [decided, setDecided] = useState<Expense[] | null>(null);
  const [baseCurrency, setBaseCurrency] = useState('INR');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const canEdit = perms.has('finance.business.edit');

  const load = async (spinner: boolean) => {
    if (spinner) setLoading(true);
    setError(null);
    try {
      const [s, p, d] = await Promise.all([
        financeApi.getSettings(),
        financeApi.listApprovals('pending'),
        financeApi.listApprovals('decided'),
      ]);
      setSettings(s);
      setBaseCurrency(s.base_currency);
      setThresholdInput(s.approval_threshold_cents ? fromMinor(s.approval_threshold_cents, s.base_currency) : '');
      setPending(p.approvals);
      setDecided(d.approvals);
    } catch (e) {
      if (spinner) { setPending(null); setDecided(null); }
      setError(humanError(e));
    } finally {
      if (spinner) setLoading(false);
    }
  };

  useEffect(() => { void load(true); /* eslint-disable-next-line */ }, []);

  const saveThreshold = async () => {
    setSavingThreshold(true);
    setError(null);
    try {
      const cents = thresholdInput.trim() ? toMinor(thresholdInput, baseCurrency) : 0;
      if (!Number.isFinite(cents) || cents < 0) { setError('Enter a valid threshold.'); return; }
      await financeApi.putSettings(cents);
      await load(false);
    } catch (e) { setError(humanError(e)); } finally { setSavingThreshold(false); }
  };

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setDecidingId(id);
    setError(null);
    try {
      await financeApi.decideApproval(id, decision, notes[id] ?? null);
      await load(false);
    } catch (e) { setError(humanError(e)); } finally { setDecidingId(null); }
  };

  const threshold = settings?.approval_threshold_cents ?? 0;

  return (
    <>
      {error && (
        <div className="fin-banner" role="alert">
          {error}
          <button className="fin-link" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {/* Threshold setting */}
      <section className="fin-panel" aria-label="Approval threshold">
        <div className="fin-panel-header">Approval threshold</div>
        <div className="fin-pad fin-threshold">
          <p className="fin-muted">
            Expenses at or above this amount need approval before they count toward the P&amp;L.
            Set to 0 to turn approvals off.
          </p>
          <div className="fin-threshold-row">
            <input
              type="number" min="0" step="any" inputMode="decimal"
              value={thresholdInput}
              onChange={(e) => setThresholdInput(e.target.value)}
              disabled={!canEdit || savingThreshold}
              placeholder="0"
              aria-label={`Threshold in ${baseCurrency}`}
            />
            <span className="fin-muted">{baseCurrency}</span>
            {canEdit && (
              <button className="btn btn-primary fin-add-btn" onClick={saveThreshold} disabled={savingThreshold}>
                {savingThreshold ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
          {threshold > 0 && (
            <p className="fin-muted">Currently: {formatMoney(threshold, baseCurrency)}</p>
          )}
        </div>
      </section>

      {loading && (
        <section className="fin-panel"><p className="fin-muted fin-pad">Loading…</p></section>
      )}

      {/* Pending queue */}
      {!loading && (
        <section className="fin-panel" aria-label="Pending approvals">
          <div className="fin-panel-header">Awaiting approval {pending && pending.length > 0 && <span className="fin-count">{pending.length}</span>}</div>
          {pending && pending.length === 0 && (
            <p className="fin-empty">Nothing awaiting approval. 🎉</p>
          )}
          {pending && pending.length > 0 && (
            <ul className="fin-approval-list">
              {pending.map((e) => (
                <li key={e.id} className="fin-approval-row">
                  <div className="fin-approval-main">
                    <span className="fin-tag">{CATEGORY_LABELS[e.category]}</span>
                    <span className="fin-approval-amt">{formatMoney(e.amount_base_cents, baseCurrency)}</span>
                    <span className="fin-muted">{formatDay(e.incurred_on)}</span>
                    {e.note && <span className="fin-approval-note">{e.note}</span>}
                  </div>
                  {canEdit && (
                    <div className="fin-approval-actions">
                      <input
                        className="fin-approval-reason"
                        placeholder="reason (optional)"
                        value={notes[e.id] ?? ''}
                        onChange={(ev) => setNotes((n) => ({ ...n, [e.id]: ev.target.value }))}
                      />
                      <button className="btn btn-primary fin-add-btn" disabled={decidingId === e.id}
                        onClick={() => decide(e.id, 'approve')}>Approve</button>
                      <button className="btn btn-danger fin-add-btn" disabled={decidingId === e.id}
                        onClick={() => decide(e.id, 'reject')}>Reject</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Decided history */}
      {!loading && decided && decided.length > 0 && (
        <section className="fin-panel" aria-label="Recent decisions">
          <div className="fin-panel-header">Recent decisions</div>
          <table className="fin-table">
            <thead>
              <tr><th>Category</th><th>Date</th><th className="fin-num">Amount</th><th>Decision</th><th>Reason</th></tr>
            </thead>
            <tbody>
              {decided.map((e) => (
                <tr key={e.id}>
                  <td><span className="fin-tag">{CATEGORY_LABELS[e.category]}</span></td>
                  <td>{formatDay(e.incurred_on)}</td>
                  <td className="fin-num">{formatMoney(e.amount_base_cents, baseCurrency)}</td>
                  <td>
                    <span className={`fin-status ${e.approval_status === 'approved' ? 'fin-status-on' : 'fin-status-rej'}`}>
                      {e.approval_status === 'approved' ? 'Approved' : 'Rejected'}
                    </span>
                  </td>
                  <td className="fin-note-cell">{e.approval_note || <span className="fin-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
