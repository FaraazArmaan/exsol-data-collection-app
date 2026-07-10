// Owner-facing Manage Team page. Mirrors src/modules/ams/pages/AccessDashboard.tsx
// for the bucket-user surface:
//
//   - Drops <ClientProductsSection> (admin product-toggling UI).
//   - Sources clientId/slug from useUserAuth() + useParams(), NOT from a URL
//     :clientId param — owners reach this page via /c/:slug/team and the
//     server resolves the client from the bu_session JWT.
//   - Reuses LevelRow + UserNodeChip from ../../ams/components verbatim
//     (props are auth-agnostic; no surgery needed).
//   - Renders the shared team modals (src/modules/shared/team-modals) with
//     the owner-scoped api + copy bag from ../team/team-modal-api.
//
// The handleDragEnd logic is copied verbatim from AccessDashboard.tsx (the
// dnd id format + re-parent fallback logic is the source of truth) — only
// the API call swaps to the owner-scoped moveNode(nodeId, parent, level).

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useUserAuth } from '../user-auth-context';
import {
  getStructure, listNodes, moveNode,
  type ClientStructure, type ClientRole, type UserNode,
} from '../team/api';
import { TeamLevelBox } from '../team/TeamLevelBox';
import '../team/team.css';
import { AddUserModal } from '../../shared/team-modals/AddUserModal';
import { EditUserModal } from '../../shared/team-modals/EditUserModal';
import { LoginManageModal } from '../../shared/team-modals/LoginManageModal';
import { BulkInviteModal } from '../../shared/team-modals/BulkInviteModal';
import { BulkActionBar } from '../../shared/team-modals/BulkActionBar';
import { ownerApi, ownerCopy } from '../team/team-modal-api';

export default function UserManageTeam() {
  const { slug } = useParams<{ slug: string }>();
  const { user, client } = useUserAuth();
  const [structure, setStructure] = useState<ClientStructure | null>(null);
  const [structLoading, setStructLoading] = useState(true);
  const [structError, setStructError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<UserNode[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkInvite, setShowBulkInvite] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Two-tier chip click model: edit modal opens first; from inside it the
  // owner can hop into the LoginManageModal for credential ops. They never
  // overlap. (Mirrors AccessDashboard.)
  const [editingChip, setEditingChip] = useState<UserNode | null>(null);
  const [loginChip, setLoginChip] = useState<UserNode | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Per-level "narrowed parent" used only by drag/drop target selection.
  // Primary chip clicks open edit; they do not narrow rows, matching the admin
  // AccessDashboard behavior.
  const [narrowed, setNarrowed] = useState<Record<number, string | null>>({});

  // 5px activation distance — without it dnd-kit's PointerSensor swallows the
  // synthetic click event and chips become un-clickable. (Saved session
  // feedback about click-vs-drag.)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function refreshStructure() {
    setStructLoading(true); setStructError(null);
    const r = await getStructure();
    setStructLoading(false);
    if (!r.ok) { setStructError(`Failed to load structure (${r.error.code})`); return; }
    setStructure(r.data);
  }

  async function refreshNodes() {
    setNodesLoading(true); setNodesError(null);
    const r = await listNodes();
    setNodesLoading(false);
    if (!r.ok) { setNodesError(`Failed to load users (${r.error.code})`); return; }
    setNodes(r.data.nodes);
  }

  useEffect(() => {
    void refreshStructure();
    void refreshNodes();
  }, []);

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

  function nodesForLevel(levelNumber: number): UserNode[] {
    const all = nodesByLevel.get(levelNumber) ?? [];
    if (levelNumber === 1) return all;
    const parentLevel = levelNumber - 1;
    const parentId = narrowed[parentLevel];
    if (parentId === null || parentId === undefined) return all;
    return all.filter((n) => n.parent_id === parentId);
  }

  function handleChipClick(n: UserNode) {
    setEditingChip(n);
  }

  // ── handleDragEnd: copied verbatim from AccessDashboard.tsx, only the
  // API call (moveUserNode → moveNode) and error-decoding helpers swap.
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

    const r = await moveNode(data.nodeId, newParent, newLevel);
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

  if (!slug || !user || !client) return null;
  if (structLoading || nodesLoading) return <p className="muted">Loading…</p>;
  if (structError) return <p className="error">{structError}</p>;
  if (nodesError) return <p className="error">{nodesError}</p>;
  if (!structure) return null;

  const hasStructure = structure.roles.length > 0 && structure.levels.length > 0;
  const isOwner = user.level_number == null || user.level_number === 1;

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <section>
        <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0 }}>Manage team</h1>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              {client.name} · {nodes.length} {nodes.length === 1 ? 'user' : 'users'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {!selectMode && (
              <>
                {isOwner && (
                  <>
                    <Link to={`/c/${slug}/team/access-levels`} className="btn btn-secondary">Access levels</Link>
                    <Link to={`/c/${slug}/team/audit`} className="btn btn-secondary">Audit</Link>
                    <Link to={`/c/${slug}/team/configure`} className="btn btn-secondary">Configure</Link>
                  </>
                )}
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

        {!hasStructure && (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              No roles or levels configured yet. Ask your admin to configure structure first.
            </p>
          </div>
        )}

        {moveError && <p className="error">{moveError}</p>}

        {structure.levels.map((l) => {
          const parentLevel = l.level_number - 1;
          const parentId = narrowed[parentLevel];
          const parentNode = parentId ? nodes.find((n) => n.id === parentId) : null;
          const subtitle = l.level_number > 1 && parentNode ? `under ${parentNode.display_name}` : undefined;
          return (
            <TeamLevelBox
              key={l.id}
              dropId={`level:${l.level_number}`}
              title={`Level ${l.level_number}${l.label ? ` · ${l.label}` : ''}`}
              subtitle={subtitle}
              nodes={nodesForLevel(l.level_number)}
              rolesById={rolesById}
              onChipClick={handleChipClick}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={(id) => setSelectedIds((prev) => {
                const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;
              })}
            />
          );
        })}

        <TeamLevelBox
          dropId="unassigned"
          title="Unassigned access"
          nodes={nodesByLevel.get('unassigned') ?? []}
          rolesById={rolesById}
          onChipClick={handleChipClick}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onToggleSelect={(id) => setSelectedIds((prev) => {
            const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;
          })}
        />

        {showAdd && (
          <AddUserModal
            api={ownerApi}
            copy={ownerCopy}
            title="Add team member"
            clientSlug={slug}
            roles={structure.roles}
            levels={structure.levels}
            nodes={nodes}
            onClose={() => setShowAdd(false)}
            onCreated={async () => { setShowAdd(false); await refreshNodes(); }}
          />
        )}

        {editingChip && (
          <EditUserModal
            api={ownerApi}
            copy={ownerCopy}
            caps={{ canChangeRole: user.level_number === 1 }}
            node={editingChip}
            role={rolesById[editingChip.role_id]}
            roles={structure.roles}
            levels={structure.levels}
            callerUserNodeId={user.id}
            clientSlug={slug}
            nodes={nodes}
            onClose={() => setEditingChip(null)}
            onSaved={async () => { setEditingChip(null); await refreshNodes(); }}
            onDeleted={async () => { setEditingChip(null); await refreshNodes(); }}
            onManageLogin={() => {
              // Close edit, open login. Same node stays selected so drill
              // context is preserved when the drawer closes.
              setLoginChip(editingChip);
              setEditingChip(null);
            }}
          />
        )}

        {loginChip && (
          <LoginManageModal
            api={ownerApi}
            copy={ownerCopy}
            node={loginChip}
            clientSlug={slug}
            onClose={() => setLoginChip(null)}
            onChanged={refreshNodes}
          />
        )}

        {showBulkInvite && structure && (
          <BulkInviteModal
            api={ownerApi}
            roles={structure.roles}
            levels={structure.levels}
            onClose={() => setShowBulkInvite(false)}
            onCreated={async ({ created, logins }) => {
              setShowBulkInvite(false);
              await refreshNodes();
              window.alert(`Created ${created} user${created === 1 ? '' : 's'}${logins > 0 ? `, ${logins} with login${logins === 1 ? '' : 's'}` : ''}.`);
            }}
          />
        )}

        {selectMode && structure && (
          <BulkActionBar
            api={ownerApi}
            selectedIds={selectedIds}
            nodes={nodes}
            roles={structure.roles}
            levels={structure.levels}
            onCleared={() => setSelectedIds(new Set())}
            onChanged={async () => { setSelectMode(false); setSelectedIds(new Set()); await refreshNodes(); }}
          />
        )}
      </section>
    </DndContext>
  );
}
