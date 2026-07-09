import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

interface TokenInfo {
  purpose: 'invite' | 'reset';
  email: string;
  display_name: string;
  client: { id: string; slug: string; name: string };
  expires_at: string;
}

export default function SetPasswordPage() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const r = await fetch(`/api/u-credential-token?token=${encodeURIComponent(token)}`, { credentials: 'same-origin' });
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.status === 410 ? 'This link has expired or was already used.' : 'This link is invalid.');
        return;
      }
      setInfo(await r.json() as TokenInfo);
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSubmitting(true);
    setError(null);
    const r = await fetch('/api/u-credential-token', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.status === 410 ? 'This link has expired or was already used.' : 'Could not set password.');
      return;
    }
    const body = await r.json() as { client: { slug: string } };
    navigate(`/c/${body.client.slug}/login`, { replace: true });
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ width: 'min(420px, 92vw)' }}>
        <h1 style={{ marginBottom: 4 }}>Set Password</h1>
        {loading && <p className="muted">Loading...</p>}
        {error && <p className="error">{error}</p>}
        {info && (
          <form onSubmit={submit}>
            <p className="muted" style={{ marginTop: 0 }}>
              {info.display_name} - {info.client.name}
            </p>
            <label>Email
              <input readOnly value={info.email} />
            </label>
            <label>New password
              <input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label>Confirm password
              <input type="password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={submitting}>
              {submitting ? 'Saving...' : 'Set password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
