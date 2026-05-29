import { useState, type FormEvent } from 'react';
import { createRole, deleteRole, patchRole, type ClientRole } from '../api';

interface Props {
  clientId: string;
  roles: ClientRole[];
  onChange: () => void;
}

export function RoleEditor({ clientId, roles, onChange }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Which role row is currently being edited inline (by id), or null.
  const [editingId, setEditingId] = useState<string | null>(null);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null); setSubmitting(true);
    const r = await createRole(clientId, { key, label, color });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'role_key_taken' ? 'Role key already exists.' : `Failed (${r.error.code})`);
      return;
    }
    setKey(''); setLabel(''); setColor('#3b82f6'); setShowAdd(false);
    onChange();
  }

  async function handleDelete(role: ClientRole) {
    if (!confirm(`Delete role "${role.label}"?`)) return;
    const r = await deleteRole(role.id);
    if (!r.ok) {
      alert(r.error.code === 'role_in_use'
        ? 'Cannot delete — users still have this role. Reassign or delete those users first.'
        : `Failed (${r.error.code})`);
      return;
    }
    onChange();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Roles</h3>
        <button className="btn btn-secondary" onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Cancel' : '+ Add role'}</button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} style={{ background: 'var(--bg-elevated, #1a1a1a)', padding: 12, borderRadius: 6, marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '1 1 100px' }}>Key
            <input type="text" required value={key} onChange={(e) => setKey(e.target.value)} placeholder="owner" pattern="^[a-z][a-z0-9_]*$" title="lowercase + underscore + digits, starting with a letter" />
          </label>
          <label style={{ flex: '1 1 140px' }}>Label
            <input type="text" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Owner" />
          </label>
          <label style={{ flex: '0 0 80px' }}>Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 32, width: '100%' }} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '…' : 'Add'}</button>
          {error && <p className="error" style={{ width: '100%', margin: '4px 0 0' }}>{error}</p>}
        </form>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {roles.map((r) => (
          editingId === r.id ? (
            <RoleEditRow
              key={r.id}
              role={r}
              onCancel={() => setEditingId(null)}
              onSaved={() => { setEditingId(null); onChange(); }}
            />
          ) : (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, background: r.color, flexShrink: 0 }} />
              <span style={{ flex: 1 }}><strong>{r.label}</strong> <span className="muted" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.key}</span></span>
              <button className="btn btn-ghost" onClick={() => setEditingId(r.id)} title="Edit label + color">✎</button>
              <button className="btn btn-ghost" onClick={() => handleDelete(r)} title="Delete role">×</button>
            </li>
          )
        ))}
        {roles.length === 0 && <li className="muted">No roles yet.</li>}
      </ul>
    </div>
  );
}

interface EditProps {
  role: ClientRole;
  onCancel: () => void;
  onSaved: () => void;
}

function RoleEditRow({ role, onCancel, onSaved }: EditProps) {
  const [label, setLabel] = useState(role.label);
  const [color, setColor] = useState(role.color);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = label.trim() !== role.label || color !== role.color;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!changed) { onCancel(); return; }
    const trimmed = label.trim();
    if (!trimmed) { setError('Label required.'); return; }
    setSubmitting(true);
    const r = await patchRole(role.id, { label: trimmed, color });
    setSubmitting(false);
    if (!r.ok) { setError(`Failed (${r.error.code})`); return; }
    onSaved();
  }

  return (
    <li style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <form onSubmit={handleSave} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ flex: '0 0 80px' }}>Color
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 32, width: '100%' }} />
        </label>
        <label style={{ flex: '1 1 140px' }}>Label
          <input type="text" required value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
        <span className="muted" style={{ alignSelf: 'center', fontSize: 11, fontFamily: 'var(--font-mono)' }} title="The role key is immutable — it's referenced by stored data.">
          key: {role.key}
        </span>
        <button type="submit" className="btn btn-primary" disabled={submitting || !changed}>{submitting ? '…' : 'Save'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
        {error && <p className="error" style={{ width: '100%', margin: '4px 0 0' }}>{error}</p>}
      </form>
    </li>
  );
}
