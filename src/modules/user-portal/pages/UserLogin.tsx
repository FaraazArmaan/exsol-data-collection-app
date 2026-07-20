import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getClientBySlug, userLogin } from '../api';
import { useUserAuth } from '../user-auth-context';
import { GoogleSignInButton } from '../../../lib/google-signin';
import { unifiedGoogleLogin, forgotPassword } from '../../login/api';
import { Button } from '../../../components/ui/Button';
import { InlineNotice } from '../../../components/ui/Feedback';
import { Field, Input } from '../../../components/ui/Field';

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
  const [forgotMode, setForgotMode] = useState<null | 'form' | 'sent'>(null);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!slug) return;
    setError(null);
    setSubmitting(true);
    const values = new FormData(e.currentTarget);
    const r = await userLogin(slug, String(values.get('email') ?? '').trim(), String(values.get('password') ?? ''));
    setSubmitting(false);
    if (!r.ok) {
      if (r.error.code === 'too_many_attempts') {
        setError('Too many attempts. Try again in a few minutes.');
      } else if (r.error.code === 'unauthorized') {
        setError('Email or password incorrect.');
      } else {
        setError(`Login failed (${r.error.code}).`);
      }
      return;
    }
    await refresh();
    navigate(r.data.user.must_change_password ? `/c/${slug}/change-password` : `/c/${slug}`, { replace: true });
  }

  const handleGoogleCredential = useCallback(async (idToken: string) => {
    if (!slug) return;
    setError(null);
    setSubmitting(true);
    // Always scope to this client's slug — we know exactly which workspace
    // the user is signing in to, so no picker needed.
    const r = await unifiedGoogleLogin(idToken, slug);
    setSubmitting(false);
    if (!r.ok) {
      setError("We couldn't find a matching account for that Google identity. Ask your admin to add you.");
      return;
    }
    if (r.data.kind !== 'bucket_user') {
      setError('This workspace expected a user account; Google returned a different kind.');
      return;
    }
    await refresh();
    const dest = r.data.user.must_change_password ? `/c/${slug}/change-password` : `/c/${slug}`;
    navigate(dest, { replace: true });
  }, [slug, navigate, refresh]);

  async function onForgotSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submittedEmail = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    if (!submittedEmail || !slug) return;
    setForgotSubmitting(true);
    // Scope to this client's slug — server only flips the flag on credentials
    // matching the email within this client, not across the whole org.
    await forgotPassword(submittedEmail, slug);
    setEmail(submittedEmail);
    setForgotSubmitting(false);
    setForgotMode('sent');
  }

  if (slugError) {
    return <PageShell><h1>{slugError}</h1></PageShell>;
  }

  if (forgotMode === 'sent') {
    return (
      <PageShell>
        <h1 style={{ marginBottom: 4 }}>Request sent</h1>
        <p style={{ marginTop: 8 }}>
          If an account exists for <strong>{email.trim()}</strong> at {clientName ?? 'this workspace'},
          an admin has been notified and will issue you a new temporary password.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          Contact your administrator if you don't hear back shortly.
        </p>
        <Button variant="primary" style={{ marginTop: 12 }} onClick={() => { setForgotMode(null); setPassword(''); }}>← Back to sign in</Button>
      </PageShell>
    );
  }

  if (forgotMode === 'form') {
    return (
      <PageShell>
        <h1 style={{ marginBottom: 4 }}>Forgot password</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Enter your email and we'll let your admin know to issue a new temporary password.
        </p>
        <form onSubmit={onForgotSubmit}>
          <Field label="Email" required>
            {(props) => <Input {...props} name="email" type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <Button type="submit" variant="primary" disabled={!email.trim()} loading={forgotSubmitting} loadingLabel="Sending…">Send request</Button>
            <Button type="button" variant="quiet" onClick={() => setForgotMode(null)} disabled={forgotSubmitting}>Cancel</Button>
          </div>
        </form>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h1 style={{ marginBottom: 4 }}>{clientName ?? 'Loading…'}</h1>
      <p className="muted" style={{ marginTop: 0 }}>Sign in to your account</p>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Email" required>
            {(props) => <Input {...props} name="email" type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Password" required>
            {(props) => <Input {...props} name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
        </div>
        <div style={{ textAlign: 'right', marginTop: -8, marginBottom: 4 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '2px 4px' }}
            onClick={() => setForgotMode('form')}
          >
            Forgot password?
          </button>
        </div>
        {error && <InlineNotice tone="danger" title="Sign in failed">{error}</InlineNotice>}
        <div style={{ marginTop: 12 }}>
          <Button type="submit" variant="primary" disabled={!clientName} loading={submitting} loadingLabel="Signing in…">Sign in</Button>
        </div>
      </form>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-subtle, #2a2a2a)' }} />
        <span className="muted" style={{ fontSize: 11 }}>OR</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-subtle, #2a2a2a)' }} />
      </div>
      <GoogleSignInButton onCredential={handleGoogleCredential} />
      <p className="muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 8 }}>
        Google sign-in only works if you already have an account at this workspace.
      </p>
      <MainLoginEscape />
    </PageShell>
  );
}

// Small, unobtrusive escape hatch back to the main /login.
// Lives at the bottom of the per-client login card so users who land here
// by mistake (or admins who want the unified login) aren't trapped.
function MainLoginEscape() {
  return (
    <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
      <a
        href="/login"
        title="Go to main login"
        aria-label="Main login"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '1px solid var(--border-subtle, #2a2a2a)',
          background: 'transparent',
          color: 'var(--text-muted, #888)',
          fontSize: 14,
          textDecoration: 'none',
          lineHeight: 1,
        }}
      >
        ↩
      </a>
    </div>
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
