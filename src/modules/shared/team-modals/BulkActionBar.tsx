// Fixed-position action bar shown when ≥1 chip is selected. The role
// dropdown shows all workspace roles since any role can be assigned at
// any level. See docs/superpowers/specs/2026-06-08-levels-roles-decoupling-design.md.

import { useMemo, useState } from 'react';
import type { ClientRole, ClientLevel, UserNode } from '../../ams/api';
import type { TeamMemberApi } from './types';

interface Props {
  api: TeamMemberApi;
  selectedIds: Set<string>;
  nodes: UserNode[];
  roles: ClientRole[];
  levels: ClientLevel[];
  onCleared: () => void;
  onChanged: () => void;
}

interface TargetError { node_id: string; reason: string }

export function BulkActionBar({ api, selectedIds, nodes, roles, levels, onCleared, onChanged }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetErrors, setTargetErrors] = useState<TargetError[]>([]);

  // Any role can be assigned at any level. See
  // docs/superpowers/specs/2026-06-08-levels-roles-decoupling-design.md.
  const eligibleRoles = roles;

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(n.id, n.display_name);
    return m;
  }, [nodes]);

  async function handlePick(roleId: string) {
    setError(null);
    setTargetErrors([]);
    setSubmitting(true);
    const r = await api.bulkRoleChange(Array.from(selectedIds), roleId);
    setSubmitting(false);
    if (!r.ok) {
      const details = r.error.details as { errors?: TargetError[] } | undefined;
      if (r.error.code === 'bulk_validation_failed' && details?.errors) {
        setTargetErrors(details.errors);
        setError(`${details.errors.length} target${details.errors.length === 1 ? '' : 's'} rejected. Selection preserved.`);
        return;
      }
      setError(`Failed (${r.error.code}).`);
      return;
    }
    onChanged();
  }

  if (selectedIds.size === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-elevated, #1a1a1a)', border: '1px solid var(--border-subtle, #2a2a2a)',
      borderRadius: 8, padding: '8px 12px', display: 'flex', flexDirection: 'column',
      gap: 6, zIndex: 50, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', minWidth: 360, maxWidth: '92vw',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13 }}>
          {selectedIds.size} selected
        </span>
        <select
          disabled={submitting}
          defaultValue=""
          onChange={(e) => { if (e.target.value) void handlePick(e.target.value); }}
        >
          <option value="">Change role to…</option>
          {eligibleRoles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <button type="button" className="btn btn-ghost" onClick={onCleared} disabled={submitting}>Clear</button>
      </div>
      {error && <p className="error" style={{ margin: 0, fontSize: 12 }}>{error}</p>}
      {targetErrors.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 120, overflowY: 'auto' }}>
          {targetErrors.map((e, i) => (
            <li key={i} className="error" style={{ fontSize: 12 }}>
              {nameById.get(e.node_id) ?? e.node_id}: {e.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
