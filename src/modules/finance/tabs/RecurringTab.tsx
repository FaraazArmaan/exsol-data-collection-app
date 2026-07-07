import { useCallback, useEffect, useState } from 'react';
import { financeApi } from '../shared/api';
import {
  CATEGORY_LABELS, CADENCE_LABELS,
  type RecurringTemplate, type RecurringInput,
} from '../shared/types';
import { formatDay, formatMoney } from '../shared/format';
import { humanError } from './OverviewTab';
import { RecurringModal } from '../components/RecurringModal';

interface Props {
  perms: ReadonlySet<string>;
}

type ModalState = { mode: 'new' } | { mode: 'edit'; template: RecurringTemplate } | null;

export function RecurringTab({ perms }: Props) {
  const [templates, setTemplates] = useState<RecurringTemplate[] | null>(null);
  const [baseCurrency, setBaseCurrency] = useState('INR');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const canCreate = perms.has('finance.business.create');
  const canEdit = perms.has('finance.business.edit');
  const canDelete = perms.has('finance.business.delete');

  const load = useCallback(async (spinner: boolean) => {
    if (spinner) setLoading(true);
    try {
      const r = await financeApi.listRecurring();
      setTemplates(r.templates);
      setBaseCurrency(r.base_currency);
    } catch (e) {
      if (spinner) setTemplates(null);
      setError(humanError(e));
    } finally {
      if (spinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    financeApi.listRecurring()
      .then((r) => { if (alive) { setTemplates(r.templates); setBaseCurrency(r.base_currency); } })
      .catch((e) => { if (alive) { setTemplates(null); setError(humanError(e)); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const handleSubmit = async (input: RecurringInput) => {
    setSaving(true);
    setError(null);
    try {
      if (modal?.mode === 'edit') await financeApi.updateRecurring(modal.template.id, input);
      else await financeApi.createRecurring(input);
      setModal(null);
      await load(false);
    } catch (e) { setError(humanError(e)); } finally { setSaving(false); }
  };

  const toggleActive = async (t: RecurringTemplate) => {
    setBusyId(t.id);
    setError(null);
    try {
      await financeApi.updateRecurring(t.id, { active: !t.active });
      await load(false);
    } catch (e) { setError(humanError(e)); } finally { setBusyId(null); }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await financeApi.removeRecurring(id);
      setConfirmingId(null);
      await load(false);
    } catch (e) { setError(humanError(e)); } finally { setBusyId(null); }
  };

  const runDue = async () => {
    setRunning(true);
    setError(null);
    setRunMsg(null);
    try {
      const r = await financeApi.runRecurring();
      setRunMsg(r.materialized > 0
        ? `Added ${r.materialized} expense${r.materialized === 1 ? '' : 's'} from due templates.`
        : 'Nothing due right now.');
      await load(false);
    } catch (e) { setError(humanError(e)); } finally { setRunning(false); }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      {error && (
        <div className="fin-banner" role="alert">
          {error}
          <button className="fin-link" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}
      {runMsg && (
        <div className="fin-note-banner" role="status">
          {runMsg}
          <button className="fin-link" onClick={() => setRunMsg(null)}>dismiss</button>
        </div>
      )}

      <section className="fin-panel" aria-label="Recurring expenses">
        <div className="fin-panel-header fin-panel-header-row">
          <span>Recurring &amp; milestones</span>
          <span className="fin-header-actions">
            {canCreate && (
              <button className="btn btn-secondary fin-add-btn" onClick={runDue} disabled={running}>
                {running ? 'Running…' : 'Run due now'}
              </button>
            )}
            {canCreate && (
              <button className="btn btn-primary fin-add-btn" onClick={() => setModal({ mode: 'new' })}>
                + New
              </button>
            )}
          </span>
        </div>

        {loading && <p className="fin-muted fin-pad">Loading…</p>}

        {!loading && templates && templates.length === 0 && (
          <div className="fin-empty">
            <p>No recurring expenses or milestones yet.</p>
            {canCreate && (
              <button className="btn btn-secondary" onClick={() => setModal({ mode: 'new' })}>
                Add a recurring expense
              </button>
            )}
          </div>
        )}

        {!loading && templates && templates.length > 0 && (
          <table className="fin-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Repeats</th>
                <th>Next run</th>
                <th className="fin-num">Amount</th>
                <th>Status</th>
                {(canEdit || canDelete) && <th className="fin-actions-col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className={t.active ? '' : 'fin-row-muted'}>
                  <td>
                    <span className="fin-tag">{CATEGORY_LABELS[t.category]}</span>
                    {t.note && <div className="fin-note-cell">{t.note}</div>}
                  </td>
                  <td>{CADENCE_LABELS[t.cadence]}</td>
                  <td>{t.active ? formatDay(t.next_run) : <span className="fin-muted">—</span>}</td>
                  <td className="fin-num">{formatMoney(t.amount_cents, t.currency)}</td>
                  <td>
                    <span className={`fin-status ${t.active ? 'fin-status-on' : 'fin-status-off'}`}>
                      {t.active ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  {(canEdit || canDelete) && (
                    <td className="fin-actions-col">
                      {confirmingId === t.id ? (
                        <span className="fin-confirm">
                          <span className="fin-muted">Delete?</span>
                          <button className="fin-link fin-danger" disabled={busyId === t.id}
                            onClick={() => handleDelete(t.id)}>{busyId === t.id ? '…' : 'Yes'}</button>
                          <button className="fin-link" onClick={() => setConfirmingId(null)}>No</button>
                        </span>
                      ) : (
                        <span className="fin-row-actions">
                          {canEdit && (
                            <button className="fin-link" disabled={busyId === t.id}
                              onClick={() => toggleActive(t)}>{t.active ? 'Pause' : 'Resume'}</button>
                          )}
                          {canEdit && (
                            <button className="fin-link" onClick={() => setModal({ mode: 'edit', template: t })}>Edit</button>
                          )}
                          {canDelete && (
                            <button className="fin-link fin-danger" onClick={() => setConfirmingId(t.id)}>Delete</button>
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
        <RecurringModal
          template={modal.mode === 'edit' ? modal.template : null}
          baseCurrency={baseCurrency}
          defaultDate={today}
          saving={saving}
          onCancel={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </>
  );
}
