import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../../lib/api-client';
import { useAuth } from '../../../lib/auth-context';

export default function LoginPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const r = await apiFetch('/api/auth-login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'unauthorized' ? 'Invalid email or password.' : 'Sign-in failed.');
      return;
    }
    await refresh();
    navigate(next, { replace: true });
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <h1>ExSol AMS</h1>
        <form onSubmit={handleSubmit}>
          <label>Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
          <label>Password
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
          {error && <p className="error">{error}</p>}
        </form>
        <p className="muted">Or use Google sign-in (Phase 3 follow-up — placeholder).</p>
      </div>
    </main>
  );
}
