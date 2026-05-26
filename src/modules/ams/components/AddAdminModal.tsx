import { useState, type FormEvent } from 'react';
import { createAdmin } from '../api';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function AddAdminModal({ onClose, onCreated }: Props) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !displayName.trim() || !password) {
      setError('All fields are required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const r = await createAdmin({
      email: email.trim(),
      display_name: displayName.trim(),
      password,
    });
    setSubmitting(false);
    if (!r.ok) {
      const code = r.error.code;
      setError(
        code === 'email_taken' ? 'An admin with this email already exists.'
        : code === 'validation_failed' ? 'Please check the fields and try again.'
        : `Failed to create admin (${code}).`,
      );
      return;
    }
    onCreated();
    onClose();
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 90vw)' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Add admin</h2>
        <form onSubmit={handleSubmit}>
          <label>Email
            <input
              type="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
            />
          </label>
          <label>Display name
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Doe"
            />
          </label>
          <label>Temporary password
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            They can change it (or bind Google sign-in) after first login.
          </p>
          {error && <p className="error">{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Adding…' : 'Add admin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
