import { useState, type FormEvent } from 'react';
import { createLevel, patchLevel, deleteLevel, type ClientLevel, type ClientRole } from '../api';

interface Props {
  clientId: string;
  levels: ClientLevel[];
  roles: ClientRole[];
  onChange: () => void;
}

export function LevelEditor({ clientId, levels, roles, onChange }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline label edit per level row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const level_number = Number(data.get('level_number'));
    const label = String(data.get('label') || '').trim() || undefined;
    setSubmitting(true); setError(null);
    const r = await createLevel(clientId, { level_number, label, allowed_role_ids: [] });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'level_number_taken' ? 'Level number already exists.' : `Failed (${r.error.code})`);
      return;
    }
    form.reset();
    setShowAdd(false);
    onChange();
  }

  async function toggleRole(level: ClientLevel, roleId: string) {
    const next = level.allowed_role_ids.includes(roleId)
      ? level.allowed_role_ids.filter((id) => id !== roleId)
      : [...level.allowed_role_ids, roleId];
    const r = await patchLevel(level.id, { allowed_role_ids: next });
    if (!r.ok) alert(`Failed (${r.error.code})`);
    onChange();
  }

  function startEdit(l: ClientLevel) {
    setEditingId(l.id);
    setEditLabel(l.label ?? '');
  }

  async function saveLabel(l: ClientLevel) {
    const next = editLabel.trim();
    if (next === (l.label ?? '')) { setEditingId(null); return; }
    const r = await patchLevel(l.id, { label: next });
    if (!r.ok) { alert(`Failed (${r.error.code})`); return; }
    setEditingId(null);
    onChange();
  }

  async function handleDelete(level: ClientLevel) {
    if (!confirm(`Delete Level ${level.level_number}?`)) return;
    const r = await deleteLevel(level.id);
    if (!r.ok) {
      alert(r.error.code === 'level_in_use'
        ? 'Cannot delete — users exist at this level.'
        : `Failed (${r.error.code})`);
      return;
    }
    onChange();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Levels</h3>
        <button className="btn btn-secondary" onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : '+ Add level'}</button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} style={{ background: 'var(--bg-elevated, #1a1a1a)', padding: 12, borderRadius: 6, marginBottom: 8, display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <label style={{ flex: '0 0 80px' }}>Number
            <input type="number" name="level_number" required min={1} defaultValue={(levels[levels.length - 1]?.level_number ?? 0) + 1} />
          </label>
          <label style={{ flex: 1 }}>Label (optional)
            <input type="text" name="label" placeholder="e.g. Top" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '…' : 'Add'}</button>
          {error && <p className="error" style={{ width: '100%', margin: '4px 0 0' }}>{error}</p>}
        </form>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {levels.map((l) => (
          <li key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ flex: '0 0 80px' }} title="Level number is immutable — it indexes existing user_nodes.">Level {l.level_number}</strong>
              {editingId === l.id ? (
                <>
                  <input
                    type="text"
                    autoFocus
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveLabel(l); } if (e.key === 'Escape') setEditingId(null); }}
                    placeholder="e.g. Top"
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-primary" onClick={() => void saveLabel(l)}>Save</button>
                  <button className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1 }} className="muted">{l.label ?? '(no label)'}</span>
                  <button className="btn btn-ghost" onClick={() => startEdit(l)} title="Edit label">✎</button>
                  <button className="btn btn-ghost" onClick={() => handleDelete(l)} title="Delete level">×</button>
                </>
              )}
            </div>
            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {roles.map((r) => {
                const on = l.allowed_role_ids.includes(r.id);
                return (
                  <button key={r.id} onClick={() => toggleRole(l, r.id)} style={{
                    padding: '2px 8px', borderRadius: 12, fontSize: 12,
                    border: `1px solid ${r.color}`,
                    background: on ? r.color : 'transparent',
                    color: on ? '#fff' : 'inherit',
                    cursor: 'pointer',
                  }}>{r.label}</button>
                );
              })}
              {roles.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No roles defined yet.</span>}
            </div>
          </li>
        ))}
        {levels.length === 0 && <li className="muted">No levels yet.</li>}
      </ul>
    </div>
  );
}
