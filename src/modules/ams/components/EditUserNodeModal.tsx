import { useState, type FormEvent } from 'react';
import { patchUserNode, deleteUserNode, type ClientRole, type UserNode } from '../api';

interface Props {
  node: UserNode;
  role: ClientRole | undefined;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onManageLogin: () => void;
}

// Edit the identity-level fields of a user node (display_name, email, phone,
// notes + any role-defined custom fields). Login management lives in
// LoginManageModal — this modal exposes a button to hand off to it.
export function EditUserNodeModal({ node, role, onClose, onSaved, onDeleted, onManageLogin }: Props) {
  const [displayName, setDisplayName] = useState(node.display_name);
  const [email, setEmail] = useState(node.email ?? '');
  const [phone, setPhone] = useState(node.phone ?? '');
  const [notes, setNotes] = useState(node.notes ?? '');
  const [fields, setFields] = useState<Record<string, unknown>>(node.fields ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    displayName.trim() !== node.display_name ||
    (email.trim() || null) !== (node.email ?? null) ||
    (phone.trim() || null) !== (node.phone ?? null) ||
    (notes.trim() || null) !== (node.notes ?? null) ||
    JSON.stringify(fields) !== JSON.stringify(node.fields ?? {});

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!displayName.trim()) { setError('Display name is required.'); return; }
    if (!dirty) { onClose(); return; }
    setSubmitting(true);
    const r = await patchUserNode(node.id, {
      display_name: displayName.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      notes: notes.trim() || null,
      fields,
    });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'email_already_has_login_in_this_client'
        ? 'Email is already taken by another user in this client.'
        : `Failed (${r.error.code}).`);
      return;
    }
    onSaved();
  }

  async function handleDelete() {
    const labelHint = role?.label ? ` (${role.label})` : '';
    if (!confirm(`Delete ${node.display_name}${labelHint}? This also removes their login if any.`)) return;
    setSubmitting(true);
    const r = await deleteUserNode(node.id);
    if (!r.ok && r.error.code === 'has_children') {
      setSubmitting(false);
      if (!confirm('This user has children in the tree. Delete them and all descendants?')) return;
      setSubmitting(true);
      const r2 = await deleteUserNode(node.id, true);
      setSubmitting(false);
      if (!r2.ok) { setError(`Failed (${r2.error.code}).`); return; }
      onDeleted();
      return;
    }
    setSubmitting(false);
    if (!r.ok) { setError(`Failed (${r.error.code}).`); return; }
    onDeleted();
  }

  const roleSwatch = role?.color ?? '#888';

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: roleSwatch }} />
          <h2 style={{ margin: 0, fontSize: 18 }}>Edit {node.display_name}</h2>
          {role && <span className="muted" style={{ fontSize: 12 }}>{role.label}</span>}
        </header>

        <form onSubmit={handleSave}>
          <label>Display name *
            <input type="text" required autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>Phone
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>Notes
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          {role && role.fields.map((f) => (
            <label key={f.key}>{f.label}{f.required && ' *'}
              {f.type === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={Boolean(fields[f.key])}
                  onChange={(e) => setFields({ ...fields, [f.key]: e.target.checked })}
                />
              ) : (
                <input
                  type={f.type === 'integer' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  required={f.required}
                  value={String(fields[f.key] ?? '')}
                  onChange={(e) =>
                    setFields({
                      ...fields,
                      [f.key]: f.type === 'integer' ? Number(e.target.value) : e.target.value,
                    })
                  }
                />
              )}
            </label>
          ))}

          {error && <p className="error">{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-ghost" onClick={onManageLogin} disabled={submitting} title="Open login management for this user">
                🔑 Manage login
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleDelete} disabled={submitting} style={{ color: 'var(--danger, #ef4444)' }}>
                × Delete user
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting || !dirty}>
                {submitting ? '…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
