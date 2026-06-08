// File-explorer view of one workspace, structured around ROLES not buckets.
//
// Hierarchy:
//   📁 Workspace
//      🪪 Level N — Role label    ← one folder per role, sorted by lowest level
//         · 👤 User                 (flat — no parent_id nesting)
//                                   each user shows "↳ reports to <parent name>"
//                                   as a suffix when they have a parent_id
//
// Roles allowed at multiple levels show their lowest level for ordering with
// an "(also L2)"-style badge. Roles not assigned to any level go into a final
// "Unassigned" section at the bottom of the workspace.
//
// bucket_family is shown as a small tag next to the role label, NOT a folder
// layer — so wizard-created roles (with null bucket_family) and bulk-imported
// roles (hardcoded 'employees') both render identically in this view.

import { useEffect, useMemo, useState } from 'react';
import {
  getClientStructure, listUserNodes,
  type ClientSummary, type ClientRole, type ClientLevel, type UserNode,
} from '../../api';

const POLL_MS = 5000;

// Primary level for a role = lowest level_number where a user has that role.
// Returns null if no users have this role yet — those roles fall to the bottom.
function primaryLevelFor(role: ClientRole, nodes: UserNode[]): number | null {
  let min: number | null = null;
  for (const n of nodes) {
    if (n.role_id !== role.id || n.level_number === null) continue;
    if (min === null || n.level_number < min) min = n.level_number;
  }
  return min;
}

// All distinct levels where users with this role currently live (sorted ascending).
function allowedLevelsFor(role: ClientRole, nodes: UserNode[]): number[] {
  const set = new Set<number>();
  for (const n of nodes) {
    if (n.role_id === role.id && n.level_number !== null) set.add(n.level_number);
  }
  return Array.from(set).sort((a, b) => a - b);
}

interface Props {
  client: ClientSummary;
}

interface RoleGroup {
  role: ClientRole;
  primaryLevel: number | null;   // lowest level the role is allowed at; null if orphan
  allowedLevels: number[];        // every level it appears in (for the spanning badge)
  users: UserNode[];
}

const BUCKET_TAG: Record<string, { icon: string; label: string }> = {
  business:  { icon: '🏢', label: 'business' },
  employees: { icon: '👥', label: 'employees' },
  customers: { icon: '🛍️', label: 'customers' },
  products:  { icon: '📦', label: 'products' },
};

export function ClientFilesCard({ client }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([client.id]));
  const [nodes, setNodes] = useState<UserNode[]>([]);
  const [roles, setRoles] = useState<ClientRole[]>([]);
  const [levels, setLevels] = useState<ClientLevel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  const isWorkspaceOpen = expanded.has(client.id);

  async function fetchOnce() {
    setError(null);
    const [structRes, nodesRes] = await Promise.all([
      getClientStructure(client.id),
      listUserNodes(client.id),
    ]);
    if (!structRes.ok) { setError(`structure: ${structRes.error.code}`); return; }
    if (!nodesRes.ok) { setError(`nodes: ${nodesRes.error.code}`); return; }
    setRoles(structRes.data.roles);
    setLevels(structRes.data.levels);
    setNodes(nodesRes.data.nodes);
    setLastFetched(Date.now());
  }

  useEffect(() => {
    if (!isWorkspaceOpen) return;
    void fetchOnce();
    const id = window.setInterval(() => { void fetchOnce(); }, POLL_MS);
    return () => { window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWorkspaceOpen, client.id]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Index users by id (for parent_id → name lookups in the "reports to" suffix).
  const userById = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<string, UserNode>,
    [nodes],
  );

  // Build role groups: for each role, which levels it's allowed at + its users.
  const groups = useMemo<RoleGroup[]>(() => {
    if (roles.length === 0) return [];
    const usersByRole = new Map<string, UserNode[]>();
    for (const n of nodes) {
      const arr = usersByRole.get(n.role_id) ?? [];
      arr.push(n);
      usersByRole.set(n.role_id, arr);
    }
    const result: RoleGroup[] = roles.map((r) => {
      const primaryLevel = primaryLevelFor(r, nodes);
      const allowedLevels = allowedLevelsFor(r, nodes);
      const users = (usersByRole.get(r.id) ?? []).slice().sort(
        (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
      );
      return {
        role: r,
        primaryLevel,
        allowedLevels,
        users,
      };
    });
    // Sort: assigned roles by primaryLevel ascending, then role.sort_order,
    // then label. Orphan roles (null primaryLevel) sink to the bottom.
    result.sort((a, b) => {
      const aHas = a.primaryLevel !== null ? 1 : 0;
      const bHas = b.primaryLevel !== null ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;       // assigned first
      if (a.primaryLevel !== null && b.primaryLevel !== null && a.primaryLevel !== b.primaryLevel) {
        return a.primaryLevel - b.primaryLevel;
      }
      return a.role.sort_order - b.role.sort_order
        || a.role.label.localeCompare(b.role.label);
    });
    return result;
  }, [roles, nodes]);

  return (
    <div style={{
      fontFamily: 'var(--font-mono, ui-monospace, "SF Mono", Menlo, monospace)',
      fontSize: 13,
      lineHeight: 1.55,
      marginBottom: 4,
    }}>
      <TreeRow
        depth={0}
        glyph={isWorkspaceOpen ? '▾' : '▸'}
        icon="📁"
        label={client.name}
        meta={<>
          <code className="muted" style={{ fontSize: 11 }}>{client.slug}</code>
          {isWorkspaceOpen && <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
            · {nodes.length} user{nodes.length === 1 ? '' : 's'}
            {lastFetched && ` · ↻ ${secondsAgo(lastFetched)}`}
          </span>}
        </>}
        onClick={() => toggle(client.id)}
      />

      {error && isWorkspaceOpen && (
        <p className="error" style={{ fontSize: 12, paddingLeft: 24 }}>{error}</p>
      )}

      {isWorkspaceOpen && groups.map((g) => {
        const roleKey = `${client.id}:${g.role.id}`;
        const roleOpen = expanded.has(roleKey);
        const hasUsers = g.users.length > 0;
        const folderLabel = g.primaryLevel !== null
          ? `Level ${g.primaryLevel} — ${g.role.label}`
          : `${g.role.label} (unassigned)`;
        const spanBadge = g.allowedLevels.length > 1
          ? ` (also ${g.allowedLevels.slice(1).map((l) => `L${l}`).join(', ')})`
          : '';
        return (
          <div key={g.role.id}>
            <TreeRow
              depth={1}
              glyph={hasUsers ? (roleOpen ? '▾' : '▸') : '·'}
              icon="🪪"
              label={folderLabel + spanBadge}
              meta={<>
                <span className="muted" style={{ fontSize: 11 }}>· {g.users.length}</span>
                {g.role.bucket_family && BUCKET_TAG[g.role.bucket_family] && (
                  <span className="muted" style={{
                    fontSize: 10,
                    marginLeft: 6,
                    padding: '1px 6px',
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle, #2a2a2a)',
                  }}>
                    {BUCKET_TAG[g.role.bucket_family]!.icon} {BUCKET_TAG[g.role.bucket_family]!.label}
                  </span>
                )}
              </>}
              onClick={hasUsers ? () => toggle(roleKey) : undefined}
              muted={!hasUsers}
              roleColor={g.role.color}
            />
            {roleOpen && hasUsers && g.users.map((u) => {
              const parent = u.parent_id ? userById[u.parent_id] : null;
              return (
                <TreeRow
                  key={u.id}
                  depth={2}
                  glyph="·"
                  icon="👤"
                  label={u.display_name}
                  meta={<>
                    {u.email && <span className="muted" style={{ fontSize: 11 }}>· {u.email}</span>}
                    {u.has_login && <span title="Has login" style={{ fontSize: 11, marginLeft: 4 }}>🔑</span>}
                    {parent && (
                      <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                        ↳ reports to {parent.display_name}
                      </span>
                    )}
                  </>}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

interface TreeRowProps {
  depth: number;
  glyph: string;
  icon: string;
  label: string;
  meta?: React.ReactNode;
  onClick?: () => void;
  muted?: boolean;
  roleColor?: string;
}

function TreeRow({ depth, glyph, icon, label, meta, onClick, muted, roleColor }: TreeRowProps) {
  const clickable = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } } : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        paddingLeft: depth * 18,
        cursor: clickable ? 'pointer' : 'default',
        opacity: muted ? 0.55 : 1,
        userSelect: 'none',
      }}
    >
      <span style={{ width: 12, display: 'inline-block', textAlign: 'center', color: 'var(--text-muted, #888)' }}>{glyph}</span>
      {roleColor && (
        <span style={{ width: 8, height: 8, borderRadius: 4, background: roleColor, flexShrink: 0 }} />
      )}
      <span>{icon}</span>
      <span>{label}</span>
      {meta && <span style={{ marginLeft: 4 }}>{meta}</span>}
    </div>
  );
}

function secondsAgo(t: number): string {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}
