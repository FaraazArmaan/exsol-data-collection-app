// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { WorkforceNav } from '../components/WorkforceNav';
import { Link } from 'react-router-dom';
import {
  workforceApi,
  type WorkforceAsset,
  type AssetAssignment,
  type StaffResource,
} from '../../shared/api';
import {
  findTeamMember,
  teamMembersFromResources,
  TeamEmployeePicker,
  TeamStatusCard,
} from '../components/TeamBridge';
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

type InnerTab = 'assets' | 'assignments';

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
        </div>

        {innerTab === 'assets' && (
          <AssetsTab canCreate={canCreate} canDelete={canDelete} staff={staff} />
        )}
        {innerTab === 'assignments' && (
          <AssignmentsTab canCreate={canCreate} canEdit={canEdit} staff={staff} slug={slug} />
        )}
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

      {error && <div className="wf-error">{error}</div>}
      {assets === null && !error && <div className="wf-loading">Loading assets…</div>}
      {assets !== null && assets.length === 0 && <div className="wf-empty">No assets found.</div>}

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
                  <button
                    className="wf-btn wf-btn-danger"
                    style={{ fontSize: '0.8rem', padding: '2px 10px' }}
                    onClick={() => handleRetire(a.id)}
                  >Retire</button>
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
            {formError && <div className="wf-error">{formError}</div>}
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
            <button className="wf-btn wf-btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create asset'}
            </button>
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

      {error && <div className="wf-error">{error}</div>}
      {assignments === null && !error && <div className="wf-loading">Loading assignments…</div>}
      {assignments !== null && assignments.length === 0 && <div className="wf-empty">No assignments found.</div>}

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
                      {returnError && <div className="wf-error">{returnError}</div>}
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
                        <button
                          className="wf-btn wf-btn-primary"
                          onClick={() => handleReturn(aa.id)}
                          disabled={returning}
                        >{returning ? 'Returning…' : 'Confirm return'}</button>
                        <button
                          className="wf-btn"
                          onClick={() => { setReturningId(null); setReturnError(''); }}
                        >Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="wf-btn"
                      style={{ fontSize: '0.8rem', padding: '2px 10px', marginTop: '0.25rem' }}
                      onClick={() => { setReturningId(aa.id); setReturnCondition(''); setReturnNotes(''); }}
                    >Return</button>
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
            {assignError && <div className="wf-error">{assignError}</div>}
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
            <button className="wf-btn wf-btn-primary" type="submit" disabled={assigning}>
              {assigning ? 'Assigning…' : 'Assign asset'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
