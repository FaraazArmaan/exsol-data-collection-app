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
              <strong style={{ flex: '0 0 80px' }}>Level {l.level_number}</strong>
              <span style={{ flex: 1 }} className="muted">{l.label ?? ''}</span>
              <button className="btn btn-ghost" onClick={() => handleDelete(l)}>×</button>
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
            </div>
          </li>
        ))}
        {levels.length === 0 && <li className="muted">No levels yet.</li>}
      </ul>
    </div>
  );
}
