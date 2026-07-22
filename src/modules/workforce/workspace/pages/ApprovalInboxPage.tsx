// @vitest-environment jsdom
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { WorkforceNav } from '../components/WorkforceNav';
import {
  workforceApi,
  type ApprovalDelegation,
  type ApprovalInboxItem,
  type ApprovalPolicy,
  type ApprovalRequestType,
  type EmployeeDirectoryEntry,
} from '../../shared/api';
import { Button } from '../../../../components/ui/Button';
import { EmptyState, InlineNotice, LoadingState } from '../../../../components/ui/Feedback';
import '../../workforce.css';

interface Props { slug: string; perms: ReadonlySet<string>; }

const REQUEST_TYPES: Array<{ key: ApprovalRequestType; label: string; route: string }> = [
  { key: 'leave', label: 'Leave', route: '/leave' },
  { key: 'overtime', label: 'Overtime', route: '/overtime' },
  { key: 'shift_swap', label: 'Shift swaps', route: '/swaps' },
  { key: 'time_correction', label: 'Time corrections', route: '/punching' },
  { key: 'attendance_recovery', label: 'Attendance recovery', route: '/punching' },
  { key: 'payroll', label: 'Payroll', route: '/payroll' },
];

function nameFor(entry: EmployeeDirectoryEntry): string {
  return entry.legal_name ?? entry.display_name ?? entry.email ?? 'Unnamed Team user';
}

function policyFor(policies: ApprovalPolicy[], type: ApprovalRequestType): ApprovalPolicy | undefined {
  return policies.find(policy => policy.request_type === type);
}

export default function ApprovalInboxPage({ slug, perms }: Props) {
  const [employees, setEmployees] = useState<EmployeeDirectoryEntry[]>([]);
  const [policies, setPolicies] = useState<ApprovalPolicy[] | null>(null);
  const [delegations, setDelegations] = useState<ApprovalDelegation[]>([]);
  const [items, setItems] = useState<ApprovalInboxItem[] | null>(null);
  const [error, setError] = useState('');
  const [savingType, setSavingType] = useState<ApprovalRequestType | null>(null);
  const [delegateType, setDelegateType] = useState<ApprovalRequestType>('leave');
  const [delegateOwner, setDelegateOwner] = useState('');
  const [delegateUser, setDelegateUser] = useState('');
  const [delegateEndsAt, setDelegateEndsAt] = useState('');
  const [delegateReason, setDelegateReason] = useState('');
  const [delegating, setDelegating] = useState(false);
  const canConfigure = perms.has('workforce.employees.edit');

  const teamUsers = useMemo(() => employees.filter(employee => employee.user_node_id), [employees]);

  async function load() {
    setError('');
    try {
      const [directory, routing, inbox] = await Promise.all([
        workforceApi.listEmployeesDirectory(),
        workforceApi.getApprovalRouting(),
        workforceApi.listApprovalInbox(),
      ]);
      setEmployees(directory.employees);
      setPolicies(routing.policies);
      setDelegations(routing.delegations);
      setItems(inbox.items);
    } catch {
      setError('Could not load approval routing. Check Workforce access and try again.');
    }
  }

  useEffect(() => { void load(); }, []);

  async function savePolicy(type: ApprovalRequestType, form: HTMLFormElement) {
    const data = new FormData(form);
    const ownerId = String(data.get('owner') ?? '');
    const hours = Number(data.get('hours') ?? 24);
    setSavingType(type);
    setError('');
    try {
      await workforceApi.saveApprovalPolicy({ request_type: type, primary_approver_user_node_id: ownerId || null, response_target_hours: hours });
      await load();
    } catch {
      setError(`Could not save the ${REQUEST_TYPES.find(item => item.key === type)?.label.toLowerCase()} policy.`);
    } finally {
      setSavingType(null);
    }
  }

  async function submitDelegation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!delegateOwner || !delegateUser || !delegateReason.trim()) {
      setError('Choose an owner, a delegate, and a reason.');
      return;
    }
    setDelegating(true);
    setError('');
    try {
      await workforceApi.createApprovalDelegation({
        request_type: delegateType,
        owner_user_node_id: delegateOwner,
        delegate_user_node_id: delegateUser,
        ends_at: delegateEndsAt ? new Date(delegateEndsAt).toISOString() : null,
        reason: delegateReason.trim(),
      });
      setDelegateUser('');
      setDelegateEndsAt('');
      setDelegateReason('');
      await load();
    } catch {
      setError('Could not create the delegation. It must be time-bound to a future time when an end is supplied.');
    } finally {
      setDelegating(false);
    }
  }

  async function revoke(delegation: ApprovalDelegation) {
    setError('');
    try {
      await workforceApi.revokeApprovalDelegation(delegation.id);
      await load();
    } catch {
      setError('Could not revoke this delegation.');
    }
  }

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="approvals" />
      <div className="wf-page-heading">
        <div>
          <h1>Approvals</h1>
          <p>One accountable queue for pending Workforce decisions. A policy routes each request type to an owner; a delegation only covers that owner for the selected period.</p>
        </div>
      </div>
      {error && <InlineNotice tone="danger" title="Approval routing needs attention." action={<Button size="compact" variant="quiet" onClick={() => void load()}>Retry</Button>}>{error}</InlineNotice>}
      {items === null && !error && <LoadingState title="Loading approval queue..." />}
      {items !== null && (
        <section className="wf-approval-section" aria-labelledby="approval-queue-heading">
          <div className="wf-section-heading"><div><h2 id="approval-queue-heading">My approval queue</h2><p>Only requests assigned to you, delegated to you, or visible through the Owner override appear here.</p></div><span className="wf-count-badge">{items.length}</span></div>
          {items.length === 0 ? <EmptyState title="No pending approvals are assigned to you." /> : (
            <div className="wf-approval-queue">
              {items.map(item => {
                const descriptor = REQUEST_TYPES.find(type => type.key === item.request_type)!;
                return <article className="wf-approval-item" key={`${item.request_type}:${item.request_id}`}>
                  <div><span className="wf-approval-type">{descriptor.label}</span><strong>{item.resource_name ?? item.summary}</strong><p>{item.resource_name ? item.summary : 'Pending decision'}</p></div>
                  <div className="wf-approval-meta"><span>{item.delegated_to_me ? 'Delegated to you' : item.owner_name ?? 'Unassigned policy'}</span><span>Due {new Date(item.due_at).toLocaleString()}</span></div>
                  <Link className="ui-button ui-button--quiet ui-button--compact" to={`/c/${slug}/workforce${descriptor.route}`}>Open</Link>
                </article>;
              })}
            </div>
          )}
        </section>
      )}
      {canConfigure && policies !== null && (
        <>
          <section className="wf-approval-section" aria-labelledby="approval-policy-heading">
            <div className="wf-section-heading"><div><h2 id="approval-policy-heading">Approval policies</h2><p>Set the primary owner and response target for each kind of decision. Leaving the owner blank uses the employee's manager where one is recorded.</p></div></div>
            <div className="wf-approval-policy-grid">
              {REQUEST_TYPES.map(type => {
                const policy = policyFor(policies, type.key);
                return <form key={type.key} className="wf-approval-policy" onSubmit={event => { event.preventDefault(); void savePolicy(type.key, event.currentTarget); }}>
                  <h3>{type.label}</h3>
                  <label className="wf-label">Primary owner
                    <select className="wf-select" name="owner" defaultValue={policy?.primary_approver_user_node_id ?? ''}>
                      <option value="">Employee manager fallback</option>
                      {teamUsers.map(employee => <option key={employee.user_node_id!} value={employee.user_node_id!}>{nameFor(employee)}</option>)}
                    </select>
                  </label>
                  <label className="wf-label">Response target (hours)
                    <input className="wf-input" name="hours" type="number" min="1" max="720" defaultValue={policy?.response_target_hours ?? 24} required />
                  </label>
                  <Button type="submit" size="compact" variant="primary" loading={savingType === type.key} loadingLabel="Saving...">Save policy</Button>
                </form>;
              })}
            </div>
          </section>
          <section className="wf-approval-section" aria-labelledby="approval-delegation-heading">
            <div className="wf-section-heading"><div><h2 id="approval-delegation-heading">Delegation cover</h2><p>Use this when the policy owner is unavailable. Delegates can only decide the selected request type and do not inherit Team access.</p></div></div>
            <form className="wf-approval-delegation-form" onSubmit={submitDelegation}>
              <label className="wf-label">Request type<select className="wf-select" value={delegateType} onChange={event => setDelegateType(event.target.value as ApprovalRequestType)}>{REQUEST_TYPES.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label>
              <label className="wf-label">Owner<select className="wf-select" value={delegateOwner} onChange={event => setDelegateOwner(event.target.value)} required><option value="">Select owner...</option>{teamUsers.map(employee => <option key={employee.user_node_id!} value={employee.user_node_id!}>{nameFor(employee)}</option>)}</select></label>
              <label className="wf-label">Delegate<select className="wf-select" value={delegateUser} onChange={event => setDelegateUser(event.target.value)} required><option value="">Select delegate...</option>{teamUsers.filter(employee => employee.user_node_id !== delegateOwner).map(employee => <option key={employee.user_node_id!} value={employee.user_node_id!}>{nameFor(employee)}</option>)}</select></label>
              <label className="wf-label">Ends at (optional)<input className="wf-input" type="datetime-local" value={delegateEndsAt} onChange={event => setDelegateEndsAt(event.target.value)} /></label>
              <label className="wf-label wf-approval-delegation-reason">Reason<input className="wf-input" value={delegateReason} minLength={3} onChange={event => setDelegateReason(event.target.value)} required /></label>
              <Button type="submit" variant="primary" loading={delegating} loadingLabel="Creating...">Delegate approval</Button>
            </form>
            <div className="wf-approval-delegations">
              {delegations.length === 0 ? <p className="wf-muted">No approval delegations recorded.</p> : delegations.map(delegation => <div key={delegation.id} className="wf-approval-delegation"><div><strong>{delegation.owner_name} to {delegation.delegate_name}</strong><p>{REQUEST_TYPES.find(type => type.key === delegation.request_type)?.label} · {delegation.reason} · {delegation.revoked_at ? 'Revoked' : delegation.ends_at ? `Ends ${new Date(delegation.ends_at).toLocaleString()}` : 'No end set'}</p></div>{!delegation.revoked_at && <Button size="compact" variant="quiet" onClick={() => void revoke(delegation)}>Revoke</Button>}</div>)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
