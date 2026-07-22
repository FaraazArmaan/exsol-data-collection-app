// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { Link } from 'react-router-dom';
import {
  workforceApi,
  type WorkforceAsset,
  type AssetAssignment,
  type AssetMaintenance,
  type ComplianceRequirement,
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

const CONDITION_LABELS: Record<string, string> = {
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  retired: 'Retired',
};

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

type InnerTab = 'assets' | 'assignments' | 'maintenance';

export default function AssetsPage({ slug, perms }: Props) {
  const [innerTab, setInnerTab] = useState<InnerTab>('assets');
  const [staff, setStaff] = useState<StaffResource[]>([]);

  const canCreate = perms.has('workforce.assets.create');
  const canEdit = perms.has('workforce.assets.edit');
  const canDelete = perms.has('workforce.assets.delete');

  useEffect(() => {
    workforceApi.listStaff().then(d => setStaff(d.resources)).catch(() => {});
  }, []);

  return (
    <div className="wf-page">
      <WorkforceNav slug={slug} active="assets" />

      <div className="wf-assets-layout">
        <div className="wf-page-heading">
          <div><h1>Assets</h1><p>Track workplace assets, ownership, maintenance, and return conditions in one operational workspace.</p></div>
        </div>
        {/* Inner tabs */}
        <div className="wf-assets-inner-tabs">
          <button
            className={`wf-assets-inner-tab${innerTab === 'assets' ? ' active' : ''}`}
            onClick={() => setInnerTab('assets')}
          >Assets</button>
          <button
            className={`wf-assets-inner-tab${innerTab === 'assignments' ? ' active' : ''}`}
            onClick={() => setInnerTab('assignments')}
          >Assignments</button>
          <button
            className={`wf-assets-inner-tab${innerTab === 'maintenance' ? ' active' : ''}`}
            onClick={() => setInnerTab('maintenance')}
          >Maintenance</button>
        </div>

        {innerTab === 'assets' && (
          <AssetsTab canCreate={canCreate} canDelete={canDelete} staff={staff} />
        )}
        {innerTab === 'assignments' && (
          <AssignmentsTab canCreate={canCreate} canEdit={canEdit} staff={staff} slug={slug} />
        )}
        {innerTab === 'maintenance' && (
          <MaintenanceTab canCreate={canCreate} />
        )}
      </div>
    </div>
  );
}

// ─── Maintenance Tab ─────────────────────────────────────────────────────────

function MaintenanceTab({ canCreate }: { canCreate: boolean }) {
  const [assets, setAssets] = useState<WorkforceAsset[]>([]);
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([]);
  const [maintenance, setMaintenance] = useState<AssetMaintenance[]>([]);
  const [error, setError] = useState('');
  const [requirementName, setRequirementName] = useState('');
  const [requirementAssetId, setRequirementAssetId] = useState('');
  const [requirementDueDays, setRequirementDueDays] = useState('');
  const [maintenanceAssetId, setMaintenanceAssetId] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [maintenanceNotes, setMaintenanceNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setLoaded(false);
    setError('');
    try {
      const [assetData, ops] = await Promise.all([
        workforceApi.listAssets(),
        workforceApi.listComplianceOps(),
      ]);
      setAssets(assetData.assets);
      setRequirements(ops.requirements.filter(req => req.requirement_type === 'asset'));
      setMaintenance(ops.maintenance);
      setLoaded(true);
    } catch {
      setError('Failed to load asset compliance operations.');
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createRequirement(e: React.FormEvent) {
    e.preventDefault();
    if (!requirementName.trim()) { setFormError('Requirement name is required.'); return; }
    setSaving(true);
    setFormError('');
    try {
      await workforceApi.createComplianceRequirement({
        requirement_type: 'asset',
        name: requirementName.trim(),
        asset_id: requirementAssetId || null,
        due_within_days: requirementDueDays ? Number(requirementDueDays) : null,
      });
      setRequirementName('');
      setRequirementAssetId('');
      setRequirementDueDays('');
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create asset requirement.');
    } finally {
      setSaving(false);
    }
  }

  async function createMaintenance(e: React.FormEvent) {
    e.preventDefault();
    if (!maintenanceAssetId) { setFormError('Select an asset.'); return; }
    if (!scheduledFor) { setFormError('Scheduled date is required.'); return; }
    setSaving(true);
    setFormError('');
    try {
      await workforceApi.createAssetMaintenance({
        asset_id: maintenanceAssetId,
        scheduled_for: scheduledFor,
        notes: maintenanceNotes || null,
      });
      setMaintenanceAssetId('');
      setScheduledFor('');
      setMaintenanceNotes('');
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to schedule maintenance.');
    } finally {
      setSaving(false);
    }
  }

  const scheduled = maintenance.filter(row => row.status === 'scheduled').length;
  const overdue = maintenance.filter(row => row.status === 'overdue').length;
  const completed = maintenance.filter(row => row.status === 'completed').length;

  if (!loaded) {
    return error
      ? <ErrorState title="Could not load asset maintenance." action={<Button size="compact" onClick={() => void load()}>Try again</Button>}>{error}</ErrorState>
      : <LoadingState title="Loading asset maintenance…" />;
  }

  return (
    <div className="wf-compliance-layout">
      {formError && <InlineNotice tone="danger" title="The asset compliance change could not be saved.">{formError}</InlineNotice>}
      <section className="wf-attendance-board">
        <div className="wf-board-stat"><strong>{requirements.length}</strong><span>Asset requirements</span></div>
        <div className="wf-board-stat"><strong>{scheduled}</strong><span>Scheduled</span></div>
        <div className="wf-board-stat"><strong>{overdue}</strong><span>Overdue</span></div>
        <div className="wf-board-stat"><strong>{completed}</strong><span>Completed</span></div>
      </section>

      <div className="wf-compliance-grid">
        <section className="wf-asset-form">
          <h3 className="wf-section-title">Asset Requirements</h3>
          {requirements.length === 0 && <EmptyState title="No asset requirements configured." />}
          {requirements.map(req => {
            const asset = assets.find(a => a.id === req.asset_id);
            return (
              <div key={req.id} className="wf-compliance-row">
                <strong>{req.name}</strong>
                <span>{asset?.name ?? 'All assets'}{req.due_within_days !== null ? ` - due in ${req.due_within_days}d` : ''}</span>
              </div>
            );
          })}
          {canCreate && (
            <form className="wf-ot-form" onSubmit={createRequirement}>
              <label className="wf-label">Requirement name
                <input className="wf-input" value={requirementName} onChange={e => setRequirementName(e.target.value)} required />
              </label>
              <div className="wf-form-row">
                <label className="wf-label">Asset
                  <select className="wf-select" value={requirementAssetId} onChange={e => setRequirementAssetId(e.target.value)}>
                    <option value="">All assets</option>
                    {assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                  </select>
                </label>
                <label className="wf-label">Due within days
                  <input className="wf-input" type="number" min="0" value={requirementDueDays} onChange={e => setRequirementDueDays(e.target.value)} />
                </label>
              </div>
              <Button type="submit" variant="primary" loading={saving} loadingLabel="Saving requirement…">Create requirement</Button>
            </form>
          )}
        </section>

        <section className="wf-asset-form">
          <h3 className="wf-section-title">Maintenance Schedule</h3>
          {maintenance.length === 0 && <EmptyState title="No maintenance rows scheduled." />}
          {maintenance.slice(0, 12).map(row => {
            const asset = assets.find(a => a.id === row.asset_id);
            return (
              <div key={row.id} className="wf-compliance-row">
                <strong>{asset?.name ?? row.asset_id}</strong>
                <span>{row.status} - {row.scheduled_for}{row.notes ? ` - ${row.notes}` : ''}</span>
              </div>
            );
          })}
          {canCreate && (
            <form className="wf-ot-form" onSubmit={createMaintenance}>
              <div className="wf-form-row">
                <label className="wf-label">Asset
                  <select className="wf-select" value={maintenanceAssetId} onChange={e => setMaintenanceAssetId(e.target.value)} required>
                    <option value="">Select asset...</option>
                    {assets.filter(asset => asset.condition !== 'retired').map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                  </select>
                </label>
                <DateField label="Scheduled for" value={scheduledFor} onChange={setScheduledFor} required />
              </div>
              <label className="wf-label">Notes
                <textarea className="wf-textarea" rows={2} value={maintenanceNotes} onChange={e => setMaintenanceNotes(e.target.value)} />
              </label>
              <Button type="submit" variant="primary" loading={saving} loadingLabel="Scheduling maintenance…">Schedule maintenance</Button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Assets Tab ───────────────────────────────────────────────────────────────

interface AssetsTabProps {
  canCreate: boolean;
  canDelete: boolean;
  staff: StaffResource[];
}

function AssetsTab({ canCreate, canDelete, staff }: AssetsTabProps) {
  const [assets, setAssets] = useState<WorkforceAsset[] | null>(null);
  const [conditionFilter, setConditionFilter] = useState('');
  const [error, setError] = useState('');

  // Create form
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formSerial, setFormSerial] = useState('');
  const [formCondition, setFormCondition] = useState('good');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    setAssets(null);
    setError('');
    try {
      const params = conditionFilter ? { condition: conditionFilter } : undefined;
      const data = await workforceApi.listAssets(params);
      setAssets(data.assets);
    } catch {
      setError('Failed to load assets.');
    }
  }

  useEffect(() => { load(); }, [conditionFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRetire(id: string) {
    if (!confirm('Retire this asset? It will be hidden from the default list but not deleted.')) return;
    try {
      await workforceApi.retireAsset(id);
      await load();
    } catch {
      setError('Failed to retire asset.');
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) { setFormError('Name is required.'); return; }
    setSubmitting(true);
    setFormError('');
    try {
      await workforceApi.createAsset({
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        serial_number: formSerial.trim() || undefined,
        condition: formCondition,
      });
      setFormName('');
      setFormDesc('');
      setFormSerial('');
      setFormCondition('good');
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create asset.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Condition filter */}
      <div style={{ marginBottom: '1rem' }}>
        <select
          className="wf-select"
          style={{ width: 'auto' }}
          value={conditionFilter}
          onChange={e => setConditionFilter(e.target.value)}
        >
          <option value="">All (excl. retired)</option>
          <option value="good">Good</option>
          <option value="fair">Fair</option>
          <option value="poor">Poor</option>
          <option value="retired">Retired</option>
        </select>
      </div>

      {error && assets === null && <ErrorState title="Could not load assets." action={<Button size="compact" onClick={() => void load()}>Try again</Button>}>{error}</ErrorState>}
      {error && assets !== null && <InlineNotice tone="danger" title="An asset action could not be completed." action={<Button size="compact" variant="quiet" onClick={() => setError('')}>Dismiss</Button>}>{error}</InlineNotice>}
      {assets === null && !error && <LoadingState title="Loading assets…" />}
      {assets !== null && assets.length === 0 && <EmptyState title="No assets found." />}

      {assets !== null && assets.length > 0 && (
        <div className="wf-asset-list">
          {assets.map(a => (
            <div key={a.id} className="wf-asset-card">
              <div className="wf-asset-header">
                <span className="wf-asset-name">{a.name}</span>
                <span className={`wf-badge-${a.condition}`}>{CONDITION_LABELS[a.condition] ?? a.condition}</span>
                {a.current_assignment_id && (
                  <span className="wf-asset-assigned-tag">Assigned</span>
                )}
              </div>
              {a.serial_number && (
                <div className="wf-asset-serial">S/N: {a.serial_number}</div>
              )}
              {a.description && (
                <div className="wf-asset-desc">{a.description}</div>
              )}
              {a.current_assignee_user_node_id && (() => {
                const assignee = findTeamMember(staff, a.current_assignee_user_node_id);
                return (
                  <div className="wf-asset-desc" style={{ fontSize: '0.8rem' }}>
                    Assignee: {assignee?.display_name ?? a.current_assignee_user_node_id}
                    {assignee?.email && <span> - {assignee.email}</span>}
                  </div>
                );
              })()}
              <div className="wf-asset-actions">
                {canDelete && a.condition !== 'retired' && (
                  <Button size="compact" variant="danger" onClick={() => handleRetire(a.id)}>Retire</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canCreate && (
        <div className="wf-asset-form" style={{ marginTop: '1.25rem' }}>
          <h3 className="wf-section-title">Add Asset</h3>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {formError && <InlineNotice tone="danger" title="The asset could not be created.">{formError}</InlineNotice>}
            <div className="wf-form-row">
              <label className="wf-label">Name *
                <input className="wf-input" value={formName} onChange={e => setFormName(e.target.value)} required />
              </label>
              <label className="wf-label">Serial number
                <input className="wf-input" value={formSerial} onChange={e => setFormSerial(e.target.value)} />
              </label>
              <label className="wf-label">Condition
                <select className="wf-select" value={formCondition} onChange={e => setFormCondition(e.target.value)}>
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="poor">Poor</option>
                </select>
              </label>
            </div>
            <label className="wf-label">Description (optional)
              <textarea className="wf-textarea" rows={2} value={formDesc} onChange={e => setFormDesc(e.target.value)} />
            </label>
            <Button type="submit" variant="primary" loading={submitting} loadingLabel="Creating asset…">Create asset</Button>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Assignments Tab ──────────────────────────────────────────────────────────

interface AssignmentsTabProps {
  canCreate: boolean;
  canEdit: boolean;
  staff: StaffResource[];
  slug: string;
}

function AssignmentsTab({ canCreate, canEdit, staff, slug }: AssignmentsTabProps) {
  const [assignments, setAssignments] = useState<AssetAssignment[] | null>(null);
  const [assets, setAssets] = useState<WorkforceAsset[]>([]);
  const [filterUserId, setFilterUserId] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [error, setError] = useState('');
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnCondition, setReturnCondition] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnError, setReturnError] = useState('');
  const [returning, setReturning] = useState(false);

  // Assign form
  const [formAssetId, setFormAssetId] = useState('');
  const [formUserNodeId, setFormUserNodeId] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const teamMembers = teamMembersFromResources(staff);
  const availableAssets = assets.filter(asset => asset.condition !== 'retired' && asset.current_assignment_id === null);

  async function loadAssetOptions() {
    try {
      const data = await workforceApi.listAssets();
      setAssets(data.assets);
    } catch {
      setAssets([]);
    }
  }

  async function load() {
    setAssignments(null);
    setError('');
    try {
      const params: { user_node_id?: string; active?: boolean } = {};
      if (filterUserId.trim()) params.user_node_id = filterUserId.trim();
      if (activeOnly) params.active = true;
      const data = await workforceApi.listAssignments(params);
      setAssignments(data.assignments);
    } catch {
      setError('Failed to load assignments.');
    }
  }

  useEffect(() => { load(); }, [filterUserId, activeOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadAssetOptions();
  }, []);

  async function handleReturn(assignmentId: string) {
    setReturning(true);
    setReturnError('');
    try {
      await workforceApi.returnAsset(assignmentId, {
        condition_at_return: returnCondition || undefined,
        notes: returnNotes || undefined,
      });
      setReturningId(null);
      setReturnCondition('');
      setReturnNotes('');
      await load();
      await loadAssetOptions();
    } catch (err: unknown) {
      setReturnError(err instanceof Error ? err.message : 'Failed to return asset.');
    } finally {
      setReturning(false);
    }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!formAssetId.trim()) { setAssignError('Select an asset.'); return; }
    if (!formUserNodeId.trim()) { setAssignError('Select a Team user.'); return; }
    setAssigning(true);
    setAssignError('');
    try {
      await workforceApi.assignAsset({
        asset_id: formAssetId.trim(),
        user_node_id: formUserNodeId.trim(),
        notes: formNotes.trim() || undefined,
      });
      setFormAssetId('');
      setFormUserNodeId('');
      setFormNotes('');
      await load();
      await loadAssetOptions();
    } catch (err: unknown) {
      setAssignError(err instanceof Error ? err.message : 'Failed to assign asset.');
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <TeamEmployeePicker
          label="Filter by Team user"
          value={filterUserId}
          onChange={setFilterUserId}
          members={teamMembers}
          blankLabel="All Team users"
        />
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
          Active only
        </label>
      </div>

      {error && assignments === null && <ErrorState title="Could not load assignments." action={<Button size="compact" onClick={() => void load()}>Try again</Button>}>{error}</ErrorState>}
      {error && assignments !== null && <InlineNotice tone="danger" title="An assignment action could not be completed." action={<Button size="compact" variant="quiet" onClick={() => setError('')}>Dismiss</Button>}>{error}</InlineNotice>}
      {assignments === null && !error && <LoadingState title="Loading assignments…" />}
      {assignments !== null && assignments.length === 0 && <EmptyState title="No assignments found." />}

      {assignments !== null && assignments.length > 0 && (
        <div className="wf-assignment-list">
          {assignments.map(aa => (
            <div key={aa.id} className="wf-assignment-card">
              <div className="wf-assignment-header">
                <span className="wf-assignment-asset">{aa.asset_name ?? aa.asset_id}</span>
                {aa.returned_at === null && (
                  <span className="wf-assignment-active">Active</span>
                )}
              </div>
              {(() => {
                const assignee = findTeamMember(staff, aa.user_node_id);
                return (
                  <div className="wf-assignment-dates">
                    User: {assignee?.display_name ?? aa.user_node_id}
                    {assignee?.email && <span> - {assignee.email}</span>}
                  </div>
                );
              })()}
              <div className="wf-assignment-dates">
                Assigned: {new Date(aa.assigned_at).toLocaleDateString()}
                {aa.returned_at && ` · Returned: ${new Date(aa.returned_at).toLocaleDateString()}`}
                {aa.condition_at_return && ` · Condition: ${aa.condition_at_return}`}
              </div>
              {aa.notes && <div className="wf-assignment-dates" style={{ fontStyle: 'italic' }}>{aa.notes}</div>}
              {canEdit && aa.returned_at === null && (
                <div>
                  {returningId === aa.id ? (
                    <div className="wf-return-form">
                      {returnError && <InlineNotice tone="danger" title="The asset could not be returned.">{returnError}</InlineNotice>}
                      <select
                        className="wf-select"
                        value={returnCondition}
                        onChange={e => setReturnCondition(e.target.value)}
                      >
                        <option value="">Condition on return (optional)</option>
                        <option value="good">Good</option>
                        <option value="fair">Fair</option>
                        <option value="poor">Poor</option>
                      </select>
                      <textarea
                        className="wf-textarea"
                        rows={2}
                        placeholder="Notes (optional)"
                        value={returnNotes}
                        onChange={e => setReturnNotes(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Button variant="primary" loading={returning} loadingLabel="Returning asset…" onClick={() => handleReturn(aa.id)}>Confirm return</Button>
                        <Button variant="quiet" onClick={() => { setReturningId(null); setReturnError(''); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="compact" variant="secondary" onClick={() => { setReturningId(aa.id); setReturnCondition(''); setReturnNotes(''); }}>Return</Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canCreate && (
        <div className="wf-asset-form" style={{ marginTop: '1.25rem' }}>
          <h3 className="wf-section-title">Assign Asset</h3>
          <form onSubmit={handleAssign} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {assignError && <InlineNotice tone="danger" title="The asset could not be assigned.">{assignError}</InlineNotice>}
            <div className="wf-form-row">
              <label className="wf-label">Asset
                <select
                  className="wf-select"
                  value={formAssetId}
                  onChange={e => setFormAssetId(e.target.value)}
                  required
                >
                  <option value="">{availableAssets.length === 0 ? 'No unassigned assets available' : 'Select asset...'}</option>
                  {availableAssets.map(asset => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}{asset.serial_number ? ` - ${asset.serial_number}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <TeamEmployeePicker
                label="Team user"
                value={formUserNodeId}
                onChange={setFormUserNodeId}
                members={teamMembers}
                required
              />
            </div>
            <TeamStatusCard
              slug={slug}
              member={findTeamMember(staff, formUserNodeId)}
            />
            <label className="wf-label">Notes (optional)
              <textarea className="wf-textarea" rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)} />
            </label>
            <Button type="submit" variant="primary" loading={assigning} loadingLabel="Assigning asset…">Assign asset</Button>
          </form>
        </div>
      )}
    </div>
  );
}
