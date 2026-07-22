// @vitest-environment jsdom
import { useEffect, useMemo, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { workforceApi, type EmployeeDirectoryEntry, type SensitiveDataGrant, type SensitiveDataScope } from '../../shared/api';
import { Button } from '../../../../components/ui/Button';
import { EmptyState, InlineNotice, LoadingState } from '../../../../components/ui/Feedback';
import '../../workforce.css';

interface Props { slug: string; perms: ReadonlySet<string>; }

const SCOPES: Array<{ key: SensitiveDataScope; label: string; description: string }> = [
  { key: 'profile', label: 'Employee profile', description: 'Personal phone, non-login email, emergency contact, and custom profile fields.' },
  { key: 'compensation', label: 'Compensation', description: 'Hourly rate history and pay-rate notes.' },
  { key: 'location_history', label: 'Location evidence', description: 'Exact worksite coordinates and clock-event location evidence.' },
];

function employeeName(employee: EmployeeDirectoryEntry): string {
  return employee.legal_name ?? employee.display_name ?? employee.email ?? 'Unnamed Team user';
}

export default function WorkforcePrivacyPage({ slug, perms }: Props) {
  const [employees, setEmployees] = useState<EmployeeDirectoryEntry[]>([]);
  const [grants, setGrants] = useState<SensitiveDataGrant[] | null>(null);
  const [userNodeId, setUserNodeId] = useState('');
  const [scope, setScope] = useState<SensitiveDataScope>('profile');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const canConfigure = perms.has('workforce.employees.edit');
  const teamUsers = useMemo(() => employees.filter(employee => employee.user_node_id), [employees]);

  async function load() {
    setError('');
    try {
      const [directory, access] = await Promise.all([workforceApi.listEmployeesDirectory(), workforceApi.listSensitiveDataGrants()]);
      setEmployees(directory.employees);
      setGrants(access.grants);
    } catch {
      setError('Only the workspace Owner can review or change sensitive Workforce data access.');
      setGrants([]);
    }
  }

  useEffect(() => { void load(); }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userNodeId || reason.trim().length < 3) { setError('Choose a Team user and give a clear business reason.'); return; }
    setSaving(true);
    setError('');
    try {
      await workforceApi.saveSensitiveDataGrant({ user_node_id: userNodeId, data_scope: scope, reason: reason.trim(), active: true });
      setReason('');
      await load();
    } catch {
      setError('Could not save the sensitive-data grant.');
    } finally {
      setSaving(false);
    }
  }

  async function revoke(grant: SensitiveDataGrant) {
    setError('');
    try {
      await workforceApi.saveSensitiveDataGrant({ user_node_id: grant.user_node_id, data_scope: grant.data_scope, reason: grant.reason, active: false });
      await load();
    } catch {
      setError('Could not revoke this grant.');
    }
  }

  return <div className="wf-page">
    <WorkforceNav slug={slug} active="privacy" />
    <div className="wf-page-heading"><div><h1>Privacy &amp; Data Access</h1><p>Team access does not automatically reveal personal profile, pay, or precise location data. The workspace Owner grants only the data scope and duration needed for a business responsibility.</p></div></div>
    {error && <InlineNotice tone="danger" title="Sensitive data access is restricted." action={<Button size="compact" variant="quiet" onClick={() => void load()}>Retry</Button>}>{error}</InlineNotice>}
    {grants === null && !error && <LoadingState title="Loading privacy access..." />}
    {grants !== null && canConfigure && <>
      <section className="wf-privacy-scope-grid" aria-label="Sensitive data scopes">{SCOPES.map(item => <article key={item.key} className="wf-privacy-scope"><h2>{item.label}</h2><p>{item.description}</p></article>)}</section>
      <section className="wf-approval-section"><div className="wf-section-heading"><div><h2>Grant access</h2><p>Every grant needs a business reason and is recorded separately from Team roles.</p></div></div>
        <form className="wf-privacy-grant-form" onSubmit={submit}>
          <label className="wf-label">Team user<select className="wf-select" value={userNodeId} onChange={event => setUserNodeId(event.target.value)} required><option value="">Select Team user...</option>{teamUsers.map(employee => <option key={employee.user_node_id!} value={employee.user_node_id!}>{employeeName(employee)}</option>)}</select></label>
          <label className="wf-label">Data scope<select className="wf-select" value={scope} onChange={event => setScope(event.target.value as SensitiveDataScope)}>{SCOPES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label className="wf-label wf-privacy-reason">Business reason<input className="wf-input" value={reason} minLength={3} onChange={event => setReason(event.target.value)} required /></label>
          <Button type="submit" variant="primary" loading={saving} loadingLabel="Saving...">Grant access</Button>
        </form>
      </section>
      <section className="wf-approval-section"><div className="wf-section-heading"><div><h2>Access register</h2><p>Revoking access immediately stops future reads. Historical access events remain for audit.</p></div></div>
        {grants.length === 0 ? <EmptyState title="No sensitive-data grants have been created." /> : <div className="wf-approval-delegations">{grants.map(grant => <div className="wf-approval-delegation" key={grant.id}><div><strong>{grant.user_name} · {SCOPES.find(item => item.key === grant.data_scope)?.label}</strong><p>{grant.reason} · {grant.active ? 'Active' : `Revoked ${grant.revoked_at ? new Date(grant.revoked_at).toLocaleString() : ''}`}</p></div>{grant.active && <Button size="compact" variant="quiet" onClick={() => void revoke(grant)}>Revoke</Button>}</div>)}</div>}
      </section>
    </>}
  </div>;
}
