// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { Link } from 'react-router-dom';
import {
  workforceApi,
  type PayrollPeriod,
  type PayrollLineItem,
  type PayrollRate,
  type PayrollExport,
  type PayrollSnapshot,
  type PayrollDispute,
  type Payslip,
  type StaffResource,
} from '../../shared/api';
import {
  findTeamMember,
  teamMembersFromResources,
  TeamEmployeePicker,
  TeamStatusCard,
} from '../components/TeamBridge';
import { Button } from '../../../../components/ui/Button';
import { DateField } from '../../../../components/ui/DateTimeField';
import { EmptyState, ErrorState, InlineNotice, LoadingState } from '../../../../components/ui/Feedback';
import '../../workforce.css';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

export default function PayrollPage({ slug, perms }: Props) {
  const [periods, setPeriods] = useState<PayrollPeriod[] | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null);
  const [lineItems, setLineItems] = useState<PayrollLineItem[]>([]);
  const [snapshot, setSnapshot] = useState<PayrollSnapshot | null>(null);
  const [rates, setRates] = useState<PayrollRate[] | null>(null);
  const [exports, setExports] = useState<PayrollExport[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [disputes, setDisputes] = useState<PayrollDispute[]>([]);
  const [disputeSubjectId, setDisputeSubjectId] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeError, setDisputeError] = useState('');
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [staff, setStaff] = useState<StaffResource[]>([]);
  const [error, setError] = useState('');
  const [exportFormat, setExportFormat] = useState<PayrollExport['export_format']>('csv');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

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
    setPeriods(null);
    setError('');
    try {
      const data = await workforceApi.listPayrollPeriods();
      setPeriods(data.periods);
    } catch {
      setError('Failed to load payroll periods.');
    }
  }

  async function loadRates() {
    setRates(null);
    try {
      const data = await workforceApi.listPayrollRates();
      setRates(data.rates);
    } catch {
      setError('Could not load payroll rates.');
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
    setSnapshot(null);
    setExports([]);
    setPayslips([]);
    setDisputes([]);
    try {
      const [data, exportData, disputeData] = await Promise.all([
        workforceApi.getPayrollPeriod(p.id),
        workforceApi.listPayrollExports(p.id),
        workforceApi.listPayrollDisputes(p.id),
      ]);
      setSelectedPeriod(data.period);
      setLineItems(data.line_items);
      setSnapshot(data.snapshot);
      setDisputeSubjectId(data.line_items[0]?.user_node_id ?? '');
      setExports(exportData.exports);
      setPayslips(exportData.payslips);
      setDisputes(disputeData.disputes);
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
      setSnapshot(data.snapshot);
      setLineItems(data.snapshot.lines);
      await loadPeriods();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to approve period.';
      setError(msg);
    }
  }

  async function handleCreateDispute(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPeriod || !disputeSubjectId || !disputeReason.trim()) {
      setDisputeError('Select an employee and describe the issue.');
      return;
    }
    setDisputeSubmitting(true);
    setDisputeError('');
    try {
      await workforceApi.createPayrollDispute({
        period_id: selectedPeriod.id,
        user_node_id: disputeSubjectId,
        reason: disputeReason.trim(),
      });
      setDisputeReason('');
      const data = await workforceApi.listPayrollDisputes(selectedPeriod.id);
      setDisputes(data.disputes);
    } catch (err: unknown) {
      setDisputeError(err instanceof Error ? err.message : 'Could not record the dispute.');
    } finally {
      setDisputeSubmitting(false);
    }
  }

  async function handleGenerateExport() {
    if (!selectedPeriod) return;
    setExporting(true);
    setExportError('');
    try {
      const data = await workforceApi.generatePayrollExport({
        period_id: selectedPeriod.id,
        export_format: exportFormat,
        metadata: { source: 'workforce-ui' },
      });
      const exportData = await workforceApi.listPayrollExports(selectedPeriod.id);
      setExports(exportData.exports.length > 0 ? exportData.exports : [data.export]);
      setPayslips(exportData.payslips.length > 0 ? exportData.payslips : data.payslips);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Failed to generate payroll export.');
    } finally {
      setExporting(false);
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

  const currentRateUsers = new Set((rates ?? []).map(r => r.user_node_id));
  const missingRateCount = lineItems.filter(li => !currentRateUsers.has(li.user_node_id)).length;
  const canExportSelected = !!selectedPeriod && selectedPeriod.status === 'approved' && snapshot?.status === 'frozen' && lineItems.length > 0;

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="payroll" />

      <div className="wf-payroll-layout">
        <div className="wf-page-heading">
          <div><h1>Payroll</h1><p>Prepare approved time, maintain rates, and generate payroll records without executing payments.</p></div>
        </div>
        {/* Notice banner */}
        <div className="wf-payroll-notice">
          PAYROLL TRACKING ONLY — no payment execution. Use this module to track rates and approved
          period totals; payments must be processed through your payroll provider.
        </div>

        {error && periods === null && <ErrorState title="Could not load payroll." action={<Button size="compact" onClick={() => { void loadPeriods(); void loadRates(); }}>Try again</Button>}>{error}</ErrorState>}
        {error && periods !== null && <InlineNotice tone="danger" title="A payroll action could not be completed." action={<Button size="compact" variant="quiet" onClick={() => setError('')}>Dismiss</Button>}>{error}</InlineNotice>}

        <div className="wf-payroll-cols">
          {/* Left: Periods */}
          <div className="wf-payroll-section">
            <h3 className="wf-section-title">Payroll Periods</h3>

            {periods === null && !error && <LoadingState title="Loading payroll periods…" />}
            {periods !== null && periods.length === 0 && (
              <EmptyState title="No payroll periods yet." />
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
                  <EmptyState title="No approved timesheet entries for this period." />
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

                <div className="wf-payroll-readiness">
                  <div className={lineItems.length > 0 ? 'wf-ready-row ok' : 'wf-ready-row'}>
                    <span>{lineItems.length > 0 ? 'Ready' : 'Blocked'}</span>
                    <strong>Approved time entries</strong>
                  </div>
                  <div className={missingRateCount === 0 ? 'wf-ready-row ok' : 'wf-ready-row warn'}>
                    <span>{missingRateCount === 0 ? 'Ready' : `${missingRateCount} missing`}</span>
                    <strong>Hourly rates</strong>
                  </div>
                  <div className={selectedPeriod.status === 'approved' ? 'wf-ready-row ok' : 'wf-ready-row warn'}>
                    <span>{selectedPeriod.status === 'approved' ? 'Locked' : 'Draft'}</span>
                    <strong>Period approval</strong>
                  </div>
                  <div className={snapshot?.status === 'frozen' ? 'wf-ready-row ok' : 'wf-ready-row warn'}>
                    <span>{snapshot?.status === 'frozen' ? 'Frozen' : 'Preview'}</span>
                    <strong>Payroll calculation</strong>
                  </div>
                </div>

                <p className="wf-muted-copy">
                  {snapshot?.status === 'frozen'
                    ? 'This period is frozen. Exports and payslips use the recorded time and rates shown here.'
                    : 'Draft totals are a live preview and can change until this period is approved.'}
                </p>

                {canApprove && selectedPeriod.status === 'draft' && (
                  <Button variant="primary" onClick={() => void handleApprovePeriod()}>Approve Period</Button>
                )}

                <div className="wf-payroll-export-box">
                  <div>
                    <div className="wf-section-title" style={{ fontSize: '0.9rem' }}>Export Register</div>
                    <p className="wf-muted-copy">Generate an export batch and draft payslips for review. This does not execute payroll.</p>
                  </div>
                  {exportError && <InlineNotice tone="danger" title="The export could not be generated.">{exportError}</InlineNotice>}
                  <div className="wf-form-row">
                    <label className="wf-label">Format
                      <select className="wf-select" value={exportFormat} onChange={e => setExportFormat(e.target.value as PayrollExport['export_format'])}>
                        <option value="csv">CSV</option>
                        <option value="json">JSON</option>
                        <option value="provider">Provider</option>
                      </select>
                    </label>
                    {canCreate && (
                      <Button type="button" variant="primary" disabled={!canExportSelected} loading={exporting} loadingLabel="Generating export…" onClick={() => void handleGenerateExport()}>Generate export</Button>
                    )}
                  </div>
                  {exports.length > 0 && (
                    <div className="wf-payroll-export-list">
                      {exports.map(item => (
                        <div key={item.id} className="wf-payroll-export-row">
                          <span>{item.export_format.toUpperCase()}</span>
                          <span>{item.status}</span>
                          <strong>{Number(item.total_amount).toFixed(2)}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  {payslips.length > 0 && (
                    <div className="wf-payroll-export-list">
                      {payslips.map(ps => {
                        const member = findTeamMember(staff, ps.user_node_id);
                        return (
                          <div key={ps.id} className="wf-payroll-export-row">
                            <span>{member?.display_name ?? ps.user_node_id.slice(0, 8)}</span>
                            <span>{ps.status}</span>
                            <strong>{ps.currency} {Number(ps.net_amount).toFixed(2)}</strong>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {selectedPeriod.status === 'approved' && snapshot?.status === 'frozen' && (
                  <section className="wf-payroll-disputes">
                    <div>
                      <div className="wf-section-title" style={{ fontSize: '0.9rem' }}>Dispute Register</div>
                      <p className="wf-muted-copy">Record a discrepancy for review. Resolving it never rewrites this approved payroll snapshot.</p>
                    </div>
                    {disputes.length > 0 && (
                      <div className="wf-payroll-export-list">
                        {disputes.map(dispute => (
                          <div key={dispute.id} className="wf-payroll-export-row">
                            <span>{dispute.subject_name ?? findTeamMember(staff, dispute.user_node_id)?.display_name ?? 'Employee'}</span>
                            <span>{dispute.status.replace('_', ' ')}</span>
                            <strong>{dispute.reason}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                    {canCreate && (
                      <form onSubmit={(e) => void handleCreateDispute(e)} className="wf-payroll-form">
                        {disputeError && <InlineNotice tone="danger" title="The dispute could not be recorded.">{disputeError}</InlineNotice>}
                        <TeamEmployeePicker label="Employee" value={disputeSubjectId} onChange={setDisputeSubjectId} members={teamMembersFromResources(staff)} required />
                        <label className="wf-label">What needs review?
                          <textarea className="wf-textarea" value={disputeReason} onChange={e => setDisputeReason(e.target.value)} required />
                        </label>
                        <Button type="submit" variant="secondary" loading={disputeSubmitting} loadingLabel="Recording dispute…">Record dispute</Button>
                      </form>
                    )}
                  </section>
                )}
              </div>
            )}

            {/* Create period form */}
            {canCreate && (
              <section>
                <h4 className="wf-section-title" style={{ fontSize: '0.9rem' }}>New Period</h4>
                <form onSubmit={(e) => void handleCreatePeriod(e)} className="wf-payroll-form">
                  {periodFormError && <InlineNotice tone="danger" title="The payroll period could not be created.">{periodFormError}</InlineNotice>}
                  <div className="wf-form-row">
                    <DateField label="Start date" value={formStart} onChange={setFormStart} required />
                    <DateField label="End date" value={formEnd} onChange={setFormEnd} required />
                  </div>
                  <Button type="submit" variant="primary" loading={periodSubmitting} loadingLabel="Creating period…">Create period</Button>
                </form>
              </section>
            )}
          </div>

          {/* Right: Rates */}
          <div className="wf-payroll-section">
            <h3 className="wf-section-title">Hourly Rates</h3>

            {rates === null && !error && <LoadingState title="Loading hourly rates…" />}
            {rates !== null && rates.length === 0 && (
              <EmptyState title="No rates configured yet." />
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
                  {rateFormError && <InlineNotice tone="danger" title="The hourly rate could not be saved.">{rateFormError}</InlineNotice>}
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
                    <DateField label="Effective from" value={rateEffective} onChange={setRateEffective} required />
                  </div>
                  <label className="wf-label">Notes (optional)
                    <input
                      className="wf-input"
                      type="text"
                      value={rateNotes}
                      onChange={e => setRateNotes(e.target.value)}
                    />
                  </label>
                  <Button type="submit" variant="primary" loading={rateSubmitting} loadingLabel="Saving rate…">Set rate</Button>
                </form>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
