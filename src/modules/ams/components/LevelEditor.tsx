import { useState, type FormEvent } from 'react';
import { createLevel, patchLevel, deleteLevel, type ClientLevel } from '../api';

interface Props {
  clientId: string;
  levels: ClientLevel[];
  onChange: () => void;
}

export function LevelEditor({ clientId, levels, onChange }: Props) {
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
    const r = await createLevel(clientId, { level_number, label });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'level_number_taken' ? 'Level number already exists.' : `Failed (${r.error.code})`);
      return;
    }
    form.reset();
    setShowAdd(false);
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
                  <span style={{ flex: 1 }} className="muted">{l.label ?? ''}</span>
                  <a
                    href={`/clients/${clientId}/access-levels?level=${l.level_number}`}
                    className="btn btn-ghost"
                    style={{ fontSize: 12 }}
                    title="Configure this level's access permissions"
                  >
                    Edit permissions →
                  </a>
                  <button className="btn btn-ghost" onClick={() => startEdit(l)} title="Edit label">✎</button>
                  <button className="btn btn-ghost" onClick={() => handleDelete(l)} title="Delete level">×</button>
                </>
              )}
            </div>
          </li>
        ))}
        {levels.length === 0 && <li className="muted">No levels yet.</li>}
      </ul>
    </div>
  );
}
