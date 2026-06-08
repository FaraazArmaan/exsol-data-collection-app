import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { ClientStructureProvider, useClientStructure } from '../components/ClientStructureContext';
import { LevelRow } from '../components/LevelRow';
import { AddUserNodeModal } from '../components/AddUserNodeModal';
import { EditUserNodeModal } from '../components/EditUserNodeModal';
import { LoginManageModal } from '../components/LoginManageModal';
import {
  listUserNodes, moveUserNode,
  type UserNode, type ClientRole, type ClientLevel,
} from '../api';
import { ClientProductsSection } from '../../admin/components/ClientProductsSection';
import { BulkInviteModal } from '../../shared/team-modals/BulkInviteModal';
import { BulkActionBar } from '../../shared/team-modals/BulkActionBar';
import { buildAdminApi } from '../components/team-modal-api';

export default function AccessDashboard() {
  const { clientId } = useParams<{ clientId: string }>();
  if (!clientId) return <p className="error">Invalid URL.</p>;
  return (
    <ClientStructureProvider clientId={clientId}>
      <DashboardInner clientId={clientId} />
    </ClientStructureProvider>
  );
}

function DashboardInner({ clientId }: { clientId: string }) {
  const { structure, loading: structLoading, error: structError, refresh: refreshStructure } = useClientStructure();
  const [nodes, setNodes] = useState<UserNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [clientSlug, setClientSlug] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  // Two-tier chip click model:
  //   editingChip → opens EditUserNodeModal (identity fields)
  //   loginChip   → opens LoginManageModal (credential management)
  // The edit modal has a "Manage login" button that closes itself and opens
  // the login modal, so the two surfaces never overlap.
  const [editingChip, setEditingChip] = useState<UserNode | null>(null);
  const [loginChip, setLoginChip] = useState<UserNode | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  // Per-level "narrowed parent" so we can show only descendants of one parent at the next level.
  const [narrowed, setNarrowed] = useState<Record<number, string | null>>({});
  const [showBulkInvite, setShowBulkInvite] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const adminApi = useMemo(() => buildAdminApi(clientId), [clientId]);

  // Require 5px of pointer movement before a chip's pointerdown becomes a drag.
  // Without this, dnd-kit's default PointerSensor activates on every pointerdown
  // and suppresses the synthetic click event — chips become un-clickable and the
  // EditUserNodeModal never opens.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function refreshNodes() {
    setNodesLoading(true); setNodesError(null);
    const r = await listUserNodes(clientId);
    setNodesLoading(false);
    if (!r.ok) { setNodesError(`Failed to load users (${r.error.code})`); return; }
    setNodes(r.data.nodes);
  }

  async function loadSlug() {
    const r = await fetch(`/api/clients-detail?id=${encodeURIComponent(clientId)}`, { credentials: 'same-origin' });
    if (r.ok) {
      const body = await r.json() as { client: { slug: string } };
      setClientSlug(body.client.slug);
    }
  }

  useEffect(() => { void refreshNodes(); void loadSlug(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  const rolesById = useMemo(
    () => Object.fromEntries((structure?.roles ?? []).map((r) => [r.id, r])) as Record<string, ClientRole>,
    [structure],
  );

  const nodesByLevel = useMemo(() => {
    const map = new Map<number | 'unassigned', UserNode[]>();
    for (const n of nodes) {
      const key = n.level_number === null ? 'unassigned' : n.level_number;
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    return map;
  }, [nodes]);

  function nodesForLevel(l: ClientLevel): UserNode[] {
    const all = nodesByLevel.get(l.level_number) ?? [];
    if (l.level_number === 1) return all;
    // When the admin has drilled into a specific parent at the level above, narrow
    // to just that parent's children. Otherwise show every node at this level
    // regardless of which parent they belong to — otherwise users under a
    // non-first parent at level-above become invisible on the dashboard.
    const parentLevel = l.level_number - 1;
    const parentId = narrowed[parentLevel];
    if (parentId === null || parentId === undefined) return all;
    return all.filter((n) => n.parent_id === parentId);
  }

  function handleChipClick(n: UserNode) {
    // Clicking a chip opens the edit modal. It must NOT also narrow the
    // level below — narrowing collapses Level N+1 to a single parent's
    // children and hides the other users that PR #5 (f19608f3) was
    // explicitly fixing for the no-narrowing render path. If a drill
    // affordance is wanted later, hang it off a separate UX surface
    // (chevron, double-click) rather than the primary click.
    setEditingChip(n);
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const data = active.data.current as { nodeId: string; currentParent: string | null; currentLevel: number | null };

    setMoveError(null);
    let newParent: string | null = null;
    let newLevel: number | null = null;

    if (overId === 'unassigned') {
      newParent = null; newLevel = null;
    } else if (overId.startsWith('level:')) {
      newLevel = Number(overId.slice(6));
      if (newLevel === 1) {
        newParent = null;
      } else {
        // Re-parent priority:
        //   1. If staying at the same level AND the existing parent is still at level-1, keep it
        //      (otherwise dropping a chip back onto its own row would silently re-parent it to
        //      "the first L1 owner", which looks like a no-op but changes the parent).
        //   2. Otherwise prefer the level's "narrowed" parent (the chip the admin drilled into).
        //   3. Fall back to the first parent at level-1.
        const parentLevel = newLevel - 1;
        const parentList = (nodesByLevel.get(parentLevel) ?? []);
        const stayingAtSameLevel = data.currentLevel === newLevel && data.currentParent !== null;
        const candidateParent = stayingAtSameLevel
          ? data.currentParent
          : (narrowed[parentLevel] ?? parentList[0]?.id ?? null);
        if (!candidateParent) { setMoveError('No parent available at level above. Add one first.'); return; }
        newParent = candidateParent;
      }
    } else {
      return;
    }

    // No optimistic mutation — call API, then refetch on success.
    const r = await moveUserNode(data.nodeId, newParent, newLevel);
    if (!r.ok) {
      const details = r.error.details as { max?: number; role_id?: string } | undefined;
      let msg: string;
      if (r.error.code === 'cardinality_exceeded') {
        const maxLabel = details?.max !== undefined ? `max ${details.max}` : 'limit reached';
        const roleLabel = details?.role_id ? (rolesById[details.role_id]?.label ?? '') : '';
        msg = `Per-parent limit reached at the target${roleLabel ? ` (${maxLabel} ${roleLabel})` : ` (${maxLabel})`}.`;
      } else if (r.error.code === 'cycle_detected') {
        msg = 'That would create a cycle.';
      } else if (r.error.code === 'parent_level_mismatch') {
        msg = 'Target level does not match parent.';
      } else {
        msg = `Move failed (${r.error.code}).`;
      }
      setMoveError(msg);
      return;
    }
    void refreshNodes();
    void refreshStructure();
  }

  if (structLoading || nodesLoading) return <p className="muted">Loading…</p>;
  if (structError) return <p className="error">{structError}</p>;
  if (nodesError) return <p className="error">{nodesError}</p>;
  if (!structure) return null;

  const hasStructure = structure.roles.length > 0 && structure.levels.length > 0;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <section>
        <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>Access dashboard</h1>
          <div style={{ display: 'flex', gap: 6 }}>
            <Link to={`/clients/${clientId}/access-levels`} className="btn btn-secondary">Access levels</Link>
            <Link to={`/clients/${clientId}/audit`} className="btn btn-secondary">Audit</Link>
            <Link to={`/clients/${clientId}/configure`} className="btn btn-secondary">Configure</Link>
            {!selectMode && (
              <>
                <button className="btn btn-secondary" disabled={!hasStructure} onClick={() => setShowBulkInvite(true)}>
                  Bulk invite
                </button>
                <button className="btn btn-secondary" disabled={!hasStructure} onClick={() => setSelectMode(true)}>
                  Select
                </button>
                <button className="btn btn-primary" disabled={!hasStructure} onClick={() => setShowAdd(true)}>
                  + Add user
                </button>
              </>
            )}
            {selectMode && (
              <button className="btn btn-secondary" onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}>
                Cancel selection
              </button>
            )}
          </div>
        </header>

        {clientSlug && (
          <div className="card" style={{ marginBottom: 16 }}>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              User login URL:&nbsp;
              <code style={{ background: 'var(--bg-elevated, #1a1a1a)', padding: '2px 6px', borderRadius: 4 }}>
                {window.location.origin}/c/{clientSlug}/login
              </code>
            </p>
          </div>
        )}

        {!hasStructure && (
          <div className="card">
            <p>No roles or levels configured yet. <Link to={`/clients/${clientId}/configure`}>Configure structure</Link> first.</p>
          </div>
        )}

        {moveError && <p className="error">{moveError}</p>}

        {structure.levels.map((l) => {
          // Subtitle only when the admin has actually drilled into a specific
          // parent. Without narrowing, this row shows users under ALL parents,
          // so labelling it "under <first owner>" would be misleading.
          const parentLevel = l.level_number - 1;
          const parentId = narrowed[parentLevel];
          const parentNode = parentId ? nodes.find((n) => n.id === parentId) : null;
          const subtitle = l.level_number > 1 && parentNode ? `under ${parentNode.display_name}` : undefined;
          return (
            <LevelRow
              key={l.id}
              dropId={`level:${l.level_number}`}
              title={`Level ${l.level_number}${l.label ? ` — ${l.label}` : ''}`}
              subtitle={subtitle}
              nodes={nodesForLevel(l)}
              rolesById={rolesById}
              onChipClick={handleChipClick}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={(id) => setSelectedIds((prev) => {
                const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
              })}
            />
          );
        })}

        <LevelRow
          dropId="unassigned"
          title="Unassigned access"
          nodes={nodesByLevel.get('unassigned') ?? []}
          rolesById={rolesById}
          onChipClick={handleChipClick}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onToggleSelect={(id) => setSelectedIds((prev) => {
            const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
          })}
        />

        {showAdd && (
          <AddUserNodeModal
            clientId={clientId}
            clientSlug={clientSlug}
            roles={structure.roles}
            levels={structure.levels}
            nodes={nodes}
            onClose={() => setShowAdd(false)}
            onCreated={async () => { setShowAdd(false); await refreshNodes(); }}
          />
        )}

        {editingChip && (
          <EditUserNodeModal
            node={editingChip}
            role={rolesById[editingChip.role_id]}
            clientSlug={clientSlug}
            nodes={nodes}
            onClose={() => setEditingChip(null)}
            onSaved={async () => { setEditingChip(null); await refreshNodes(); }}
            onDeleted={async () => { setEditingChip(null); await refreshNodes(); }}
            onManageLogin={() => {
              // Close edit, open login. Keep the same node selected so that
              // returning to the dashboard preserves the user's drill context.
              setLoginChip(editingChip);
              setEditingChip(null);
            }}
          />
        )}

        {loginChip && (
          <LoginManageModal
            node={loginChip}
            clientSlug={clientSlug}
            onClose={() => setLoginChip(null)}
            onChanged={refreshNodes}
          />
        )}

        {showBulkInvite && (
          <BulkInviteModal
            api={adminApi}
            roles={structure.roles}
            levels={structure.levels}
            onClose={() => setShowBulkInvite(false)}
            onCreated={async ({ created, logins }) => {
              setShowBulkInvite(false);
              await refreshNodes();
              // Toast — reuse alert until a toast system lands.
              window.alert(`Created ${created} user${created === 1 ? '' : 's'}${logins > 0 ? `, ${logins} with login${logins === 1 ? '' : 's'}` : ''}.`);
            }}
          />
        )}

        {selectMode && (
          <BulkActionBar
            api={adminApi}
            selectedIds={selectedIds}
            nodes={nodes}
            roles={structure.roles}
            levels={structure.levels}
            onCleared={() => setSelectedIds(new Set())}
            onChanged={async () => {
              setSelectMode(false);
              setSelectedIds(new Set());
              await refreshNodes();
            }}
          />
        )}

        <ClientProductsSection clientId={clientId} />
      </section>
    </DndContext>
  );
}
