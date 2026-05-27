import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../lib/auth-context';
import { unifiedLogin, type UnifiedLoginResponse } from '../api';

export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh: refreshAdminAuth } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Picker state — only populated when server responds with kind:'choice'.
  const [pickerClients, setPickerClients] = useState<Array<{ id: string; slug: string; name: string }> | null>(null);

  async function attempt(emailVal: string, passwordVal: string, clientSlug?: string) {
    setError(null);
    setSubmitting(true);
    const r = await unifiedLogin(emailVal, passwordVal, clientSlug);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'too_many_attempts'
        ? 'Too many attempts. Try again in a few minutes.'
        : 'Invalid email or password.');
      return;
    }
    await handleSuccess(r.data);
  }

  async function handleSuccess(data: UnifiedLoginResponse) {
    if (data.kind === 'admin') {
      await refreshAdminAuth();
      navigate('/', { replace: true });
      return;
    }
    if (data.kind === 'bucket_user') {
      const slug = data.client.slug;
      const dest = data.user.must_change_password ? `/c/${slug}/change-password` : `/c/${slug}/`;
      navigate(dest, { replace: true });
      return;
    }
    // kind: 'choice' — show picker.
    setPickerClients(data.clients);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await attempt(email.trim(), password);
  }

  async function pick(slug: string) {
    setPickerClients(null);
    await attempt(email.trim(), password, slug);
  }

  function cancelPicker() {
    setPickerClients(null);
    setPassword('');
  }

  if (pickerClients) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ width: 'min(420px, 92vw)' }}>
          <h1 style={{ marginBottom: 4 }}>Sign in to which workspace?</h1>
          <p className="muted" style={{ marginTop: 0 }}>You have access to multiple workspaces with this email.</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0' }}>
            {pickerClients.map((c) => (
              <li key={c.id} style={{ marginBottom: 6 }}>
                <button className="btn btn-secondary" style={{ width: '100%', textAlign: 'left' }} onClick={() => pick(c.slug)}>
                  <strong>{c.name}</strong>
                  <span className="muted" style={{ marginLeft: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}>{c.slug}</span>
                </button>
              </li>
            ))}
          </ul>
          <button className="btn btn-ghost" onClick={cancelPicker} style={{ marginTop: 8 }}>← Back</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ width: 'min(420px, 92vw)' }}>
        <h1 style={{ marginBottom: 4 }}>Sign in</h1>
        <p className="muted" style={{ marginTop: 0 }}>Admins, owners, employees, and customers all sign in here.</p>
        <form onSubmit={onSubmit}>
          <label>Email
            <input type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>Password
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <div style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
