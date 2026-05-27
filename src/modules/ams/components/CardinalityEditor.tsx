import { useEffect, useState } from 'react';
import { putCardinality, type ClientCardinalityRule, type ClientRole } from '../api';

interface Props {
  clientId: string;
  rules: ClientCardinalityRule[];
  roles: ClientRole[];
  onChange: () => void;
}

interface DraftRule { parent_role_id: string | null; child_role_id: string; max_children: number; }

export function CardinalityEditor({ clientId, rules, roles, onChange }: Props) {
  const [draft, setDraft] = useState<DraftRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(rules.map((r) => ({
      parent_role_id: r.parent_role_id, child_role_id: r.child_role_id, max_children: r.max_children,
    })));
  }, [rules]);

  function addRow() {
    setDraft([...draft, { parent_role_id: null, child_role_id: roles[0]?.id ?? '', max_children: 1 }]);
  }
  function update(i: number, patch: Partial<DraftRule>) {
    setDraft(draft.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function remove(i: number) {
    setDraft(draft.filter((_, idx) => idx !== i));
  }

  async function save() {
    setError(null); setSaving(true);
    const filtered = draft.filter((r) => r.child_role_id);
    const r = await putCardinality(clientId, filtered);
    setSaving(false);
    if (!r.ok) { setError(`Failed (${r.error.code})`); return; }
    onChange();
  }

  if (roles.length === 0) {
    return <div><h3 style={{ marginBottom: 8 }}>Per-parent limits</h3><p className="muted">Add roles first.</p></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Per-parent limits</h3>
        <button className="btn btn-secondary" onClick={addRow}>+ Add rule</button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {draft.map((r, i) => (
          <li key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Under</span>
            <select value={r.parent_role_id ?? ''} onChange={(e) => update(i, { parent_role_id: e.target.value || null })}>
              <option value="">(top-level)</option>
              {roles.map((rr) => <option key={rr.id} value={rr.id}>{rr.label}</option>)}
            </select>
            <span>up to</span>
            <input type="number" min={0} value={r.max_children} onChange={(e) => update(i, { max_children: Number(e.target.value) })} style={{ width: 70 }} />
            <select value={r.child_role_id} onChange={(e) => update(i, { child_role_id: e.target.value })}>
              {roles.map((rr) => <option key={rr.id} value={rr.id}>{rr.label}</option>)}
            </select>
            <button className="btn btn-ghost" onClick={() => remove(i)}>×</button>
          </li>
        ))}
        {draft.length === 0 && <li className="muted">No limits set — unlimited everywhere.</li>}
      </ul>

      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        {error && <p className="error" style={{ margin: 0, flex: 1 }}>{error}</p>}
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save limits'}</button>
      </div>
    </div>
  );
}
