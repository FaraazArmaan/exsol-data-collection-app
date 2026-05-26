import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getClientBySlug, userLogin } from '../api';
import { useUserAuth } from '../user-auth-context';

export default function UserLogin() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { refresh, user, loading: authLoading } = useUserAuth();

  const [clientName, setClientName] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      const r = await getClientBySlug(slug);
      if (cancelled) return;
      if (!r.ok) { setSlugError(r.error.code === 'not_found' ? 'No client found at this URL.' : `Error (${r.error.code}).`); return; }
      setClientName(r.data.client.name);
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // If a session already exists for this user, send them through.
  useEffect(() => {
    if (authLoading || !user || !slug) return;
    navigate(user.must_change_password ? `/c/${slug}/change-password` : `/c/${slug}`, { replace: true });
  }, [user, authLoading, slug, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!slug) return;
    setError(null);
    setSubmitting(true);
    const r = await userLogin(slug, email.trim(), password);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'unauthorized' ? 'Email or password incorrect.' : `Login failed (${r.error.code}).`);
      return;
    }
    await refresh();
    navigate(r.data.user.must_change_password ? `/c/${slug}/change-password` : `/c/${slug}`, { replace: true });
  }

  if (slugError) {
    return <PageShell><h1>{slugError}</h1></PageShell>;
  }

  return (
    <PageShell>
      <h1 style={{ marginBottom: 4 }}>{clientName ?? 'Loading…'}</h1>
      <p className="muted" style={{ marginTop: 0 }}>Sign in to your account</p>
      <form onSubmit={handleSubmit}>
        <label>Email
          <input type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>Password
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <div style={{ marginTop: 12 }}>
          <button type="submit" className="btn btn-primary" disabled={submitting || !clientName}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </PageShell>
  );
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div className="card" style={{ width: 'min(420px, 92vw)' }}>{children}</div>
    </div>
  );
}
