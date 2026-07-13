// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { Link } from 'react-router-dom';
import {
  workforceApi,
  type PayrollPeriod,
  type PayrollLineItem,
  type PayrollRate,
  type StaffResource,
} from '../../shared/api';
import {
  findTeamMember,
  teamMembersFromResources,
  TeamEmployeePicker,
  TeamStatusCard,
} from '../components/TeamBridge';
import '../../workforce.css';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

export default function PayrollPage({ slug, perms }: Props) {
  const [periods, setPeriods] = useState<PayrollPeriod[] | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const [lineItems, setLineItems] = useState<PayrollLineItem[]>([]);
  const [rates, setRates] = useState<PayrollRate[] | null>(null);
  const [staff, setStaff] = useState<StaffResource[]>([]);
  const [error, setError] = useState('');

  // Create period form
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [periodSubmitting, setPeriodSubmitting] = useState(false);
  const [periodFormError, setPeriodFormError] = useState('');

  // Set rate form
  const [rateUserNodeId, setRateUserNodeId] = useState('');
  const [rateHourly, setRateHourly] = useState('');
  const [rateEffective, setRateEffective] = useState('');
  const [rateNotes, setRateNotes] = useState('');
  const [rateSubmitting, setRateSubmitting] = useState(false);
  const [rateFormError, setRateFormError] = useState('');

  const canCreate = perms.has('workforce.payroll.create');
  const canApprove = perms.has('workforce.payroll.edit');

  async function loadPeriods() {
    setError('');
    try {
      const data = await workforceApi.listPayrollPeriods();
      setPeriods(data.periods);
    } catch {
      setError('Failed to load payroll periods.');
    }
  }

  async function loadRates() {
    try {
      const data = await workforceApi.listPayrollRates();
      setRates(data.rates);
    } catch {
      // noop
    }
  }

  useEffect(() => {
    void loadPeriods();
    void loadRates();
    workforceApi.listStaff().then(d => setStaff(d.resources)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function selectPeriod(p: PayrollPeriod) {
    setSelectedPeriod(p);
    setLineItems([]);
    try {
      const data = await workforceApi.getPayrollPeriod(p.id);
      setSelectedPeriod(data.period);
      setLineItems(data.line_items);
    } catch {
      setError('Failed to load period detail.');
    }
  }

  async function handleCreatePeriod(e: React.FormEvent) {
    e.preventDefault();
    if (!formStart || !formEnd) { setPeriodFormError('Both dates are required.'); return; }
    if (formEnd < formStart) { setPeriodFormError('End date must be on or after start date.'); return; }
    setPeriodSubmitting(true);
    setPeriodFormError('');
    try {
      await workforceApi.createPayrollPeriod({ period_start: formStart, period_end: formEnd });
      setFormStart('');
      setFormEnd('');
      await loadPeriods();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create period.';
      setPeriodFormError(msg);
    } finally {
      setPeriodSubmitting(false);
    }
  }

  async function handleApprovePeriod() {
    if (!selectedPeriod) return;
    try {
      const data = await workforceApi.approvePayrollPeriod(selectedPeriod.id);
      setSelectedPeriod(data.period);
      await loadPeriods();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to approve period.';
      setError(msg);
    }
  }

  async function handleSetRate(e: React.FormEvent) {
    e.preventDefault();
    if (!rateUserNodeId.trim()) { setRateFormError('Select a Team user.'); return; }
    const rate = parseFloat(rateHourly);
    if (!rateHourly || isNaN(rate) || rate < 0) { setRateFormError('Hourly rate must be a non-negative number.'); return; }
    if (!rateEffective) { setRateFormError('Effective from date is required.'); return; }
    setRateSubmitting(true);
    setRateFormError('');
    try {
      await workforceApi.setPayrollRate({
        user_node_id: rateUserNodeId.trim(),
        hourly_rate: rate,
        effective_from: rateEffective,
        notes: rateNotes.trim() || undefined,
      });
      setRateUserNodeId('');
      setRateHourly('');
      setRateEffective('');
      setRateNotes('');
      await loadRates();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to set rate.';
      setRateFormError(msg);
    } finally {
      setRateSubmitting(false);
    }
  }

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="payroll" />

      <div className="wf-payroll-layout">
        {/* Notice banner */}
        <div className="wf-payroll-notice">
          PAYROLL TRACKING ONLY — no payment execution. Use this module to track rates and approved
          period totals; payments must be processed through your payroll provider.
        </div>

        {error && <div className="wf-error">{error}</div>}

        <div className="wf-payroll-cols">
          {/* Left: Periods */}
          <div className="wf-payroll-section">
            <h3 className="wf-section-title">Payroll Periods</h3>

            {periods === null && <div className="wf-loading">Loading periods…</div>}
            {periods !== null && periods.length === 0 && (
              <div className="wf-empty">No payroll periods yet.</div>
            )}

            {periods !== null && periods.length > 0 && (
              <div className="wf-payroll-list">
                {periods.map(p => (
                  <div
                    key={p.id}
                    className="wf-payroll-card"
                    onClick={() => selectPeriod(p)}
                    style={selectedPeriod?.id === p.id ? { borderColor: 'var(--accent)' } : undefined}
                  >
                    <div className="wf-payroll-card-header">
                      <span className="wf-payroll-period">
                        {p.period_start} → {p.period_end}
                      </span>
                      <span className={`wf-status-badge wf-status-${p.status}`}>
                        {p.status === 'approved' ? 'Approved' : 'Draft'}
                      </span>
                    </div>
                    {p.total_amount !== null && (
                      <div className="wf-payroll-total">
                        Total: {Number(p.total_amount).toFixed(2)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Period detail */}
            {selectedPeriod && (
              <div className="wf-payroll-detail">
                <h4 className="wf-section-title" style={{ fontSize: '0.9rem' }}>
                  {selectedPeriod.period_start} → {selectedPeriod.period_end}
                </h4>

                {lineItems.length === 0 && (
                  <div className="wf-empty">No approved timesheet entries for this period.</div>
                )}

                {lineItems.length > 0 && (
                  <table className="wf-payroll-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Hours</th>
                        <th>Rate</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map(li => {
                        const member = findTeamMember(staff, li.user_node_id);
                        return (
                          <tr key={li.user_node_id}>
                            <td>
                              <strong style={{ color: 'var(--text-primary)' }}>
                                {member?.display_name ?? li.user_node_id.slice(0, 8)}
                              </strong>
                              {member?.email && (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{member.email}</div>
                              )}
                            </td>
                            <td>{li.hours}h</td>
                            <td>{li.hourly_rate.toFixed(2)}</td>
                            <td className="wf-payroll-total">{li.amount.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {canApprove && selectedPeriod.status === 'draft' && (
                  <button className="wf-btn wf-btn-success" onClick={() => void handleApprovePeriod()}>
                    Approve Period
                  </button>
                )}
              </div>
            )}

            {/* Create period form */}
            {canCreate && (
              <section>
                <h4 className="wf-section-title" style={{ fontSize: '0.9rem' }}>New Period</h4>
                <form onSubmit={(e) => void handleCreatePeriod(e)} className="wf-payroll-form">
                  {periodFormError && <div className="wf-error">{periodFormError}</div>}
                  <div className="wf-form-row">
                    <label className="wf-label">Start date
                      <input
                        className="wf-input"
                        type="date"
                        value={formStart}
                        onChange={e => setFormStart(e.target.value)}
                        required
                      />
                    </label>
                    <label className="wf-label">End date
                      <input
                        className="wf-input"
                        type="date"
                        value={formEnd}
                        onChange={e => setFormEnd(e.target.value)}
                        required
                      />
                    </label>
                  </div>
                  <button className="wf-btn wf-btn-primary" type="submit" disabled={periodSubmitting}>
                    {periodSubmitting ? 'Creating…' : 'Create period'}
                  </button>
                </form>
              </section>
            )}
          </div>

          {/* Right: Rates */}
          <div className="wf-payroll-section">
            <h3 className="wf-section-title">Hourly Rates</h3>

            {rates === null && <div className="wf-loading">Loading rates…</div>}
            {rates !== null && rates.length === 0 && (
              <div className="wf-empty">No rates configured yet.</div>
            )}

            {rates !== null && rates.length > 0 && (
              <div className="wf-payroll-list">
                {rates.map(r => {
                  const member = findTeamMember(staff, r.user_node_id);
                  return (
                    <div key={r.id} className="wf-payroll-card" style={{ cursor: 'default' }}>
                      <div className="wf-payroll-card-header">
                        <span className="wf-payroll-period">
                          {member?.display_name ?? r.user_node_id.slice(0, 8)}
                        </span>
                        <span className="wf-payroll-total">{Number(r.hourly_rate).toFixed(2)}/hr</span>
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {member?.email && <span>{member.email} - </span>}
                        From {r.effective_from}
                        {r.notes && <span> - {r.notes}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Set rate form */}
            {canCreate && (
              <section>
                <h4 className="wf-section-title" style={{ fontSize: '0.9rem' }}>Set Rate</h4>
                <form onSubmit={(e) => void handleSetRate(e)} className="wf-payroll-form">
                  {rateFormError && <div className="wf-error">{rateFormError}</div>}
                  <TeamEmployeePicker
                    label="Team user"
                    value={rateUserNodeId}
                    onChange={setRateUserNodeId}
                    members={teamMembersFromResources(staff)}
                    required
                  />
                  <TeamStatusCard
                    slug={slug}
                    member={findTeamMember(staff, rateUserNodeId)}
                  />
                  <div className="wf-form-row">
                    <label className="wf-label">Hourly rate
                      <input
                        className="wf-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={rateHourly}
                        onChange={e => setRateHourly(e.target.value)}
                        required
                      />
                    </label>
                    <label className="wf-label">Effective from
                      <input
                        className="wf-input"
                        type="date"
                        value={rateEffective}
                        onChange={e => setRateEffective(e.target.value)}
                        required
                      />
                    </label>
                  </div>
                  <label className="wf-label">Notes (optional)
                    <input
                      className="wf-input"
                      type="text"
                      value={rateNotes}
                      onChange={e => setRateNotes(e.target.value)}
                    />
                  </label>
                  <button className="wf-btn wf-btn-primary" type="submit" disabled={rateSubmitting}>
                    {rateSubmitting ? 'Saving…' : 'Set rate'}
                  </button>
                </form>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
