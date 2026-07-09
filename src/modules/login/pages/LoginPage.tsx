import { useCallback, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../lib/auth-context';
import { GoogleSignInButton } from '../../../lib/google-signin';
import { completeAdminMfa, unifiedLogin, unifiedGoogleLogin, forgotPassword, type UnifiedLoginResponse } from '../api';

export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh: refreshAdminAuth } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot-password view state: null = normal sign-in; 'form' = email input;
  // 'sent' = post-submit confirmation. Server response is the same regardless
  // of whether the email exists, so 'sent' is shown unconditionally on submit.
  const [forgotMode, setForgotMode] = useState<null | 'form' | 'sent'>(null);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

  // Picker state — only populated when server responds with kind:'choice'.
  const [pickerClients, setPickerClients] = useState<Array<{ id: string; slug: string; name: string }> | null>(null);
  const [mfaChallenge, setMfaChallenge] = useState<{ id: string; email: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  // When a picker is shown after a Google-flow attempt, we need the original
  // ID token to re-POST with `client: <slug>`. Held in state across the
  // picker interaction so the user doesn't re-prompt Google.
  const [pendingGoogleToken, setPendingGoogleToken] = useState<string | null>(null);

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
    if (data.kind === 'mfa_required') {
      setMfaChallenge({ id: data.challenge_id, email: data.admin.email });
      setMfaCode('');
      setUseRecovery(false);
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

  async function attemptGoogle(idToken: string, clientSlug?: string) {
    setError(null);
    setSubmitting(true);
    const r = await unifiedGoogleLogin(idToken, clientSlug);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'too_many_attempts'
        ? 'Too many attempts. Try again in a few minutes.'
        : "We couldn't find a matching account for that Google identity.");
      return;
    }
    await handleSuccess(r.data);
  }

  // Stable handler reference so the Google button doesn't re-render the
  // Google iframe on every parent state change.
  const handleGoogleCredential = useCallback((idToken: string) => {
    setPendingGoogleToken(idToken);
    void attemptGoogle(idToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(slug: string) {
    setPickerClients(null);
    // If the picker was triggered by a Google-flow choice response, re-POST
    // with the held idToken. Otherwise use email/password.
    if (pendingGoogleToken) {
      const tok = pendingGoogleToken;
      setPendingGoogleToken(null);
      await attemptGoogle(tok, slug);
    } else {
      await attempt(email.trim(), password, slug);
    }
  }

  function cancelPicker() {
    setPickerClients(null);
    setPassword('');
    setPendingGoogleToken(null);
  }

  async function onForgotSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setForgotSubmitting(true);
    // We don't pass `client` here — there's no client slug context on the
    // main sign-in page. Server will flip the flag on every credential row
    // matching this email across clients. Same response either way.
    await forgotPassword(email.trim());
    setForgotSubmitting(false);
    setForgotMode('sent');
  }

  async function onMfaSubmit(e: FormEvent) {
    e.preventDefault();
    if (!mfaChallenge || !mfaCode.trim()) return;
    setError(null);
    setSubmitting(true);
    const r = await completeAdminMfa(mfaChallenge.id, useRecovery
      ? { recovery_code: mfaCode.trim() }
      : { code: mfaCode.trim() });
    setSubmitting(false);
    if (!r.ok) {
      setError('Invalid verification code.');
      return;
    }
    await refreshAdminAuth();
    navigate('/', { replace: true });
  }

  if (forgotMode === 'sent') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ width: 'min(420px, 92vw)' }}>
          <h1 style={{ marginBottom: 4 }}>Request sent</h1>
          <p style={{ marginTop: 8 }}>
            If an account exists for <strong>{email.trim()}</strong>, an admin has been notified
            and will issue you a new temporary password.
          </p>
          <p className="muted" style={{ fontSize: 12 }}>
            Contact your administrator if you don't hear back shortly. There's no automated email
            yet — the new password will be shared with you directly.
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            onClick={() => { setForgotMode(null); setPassword(''); }}
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  if (forgotMode === 'form') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ width: 'min(420px, 92vw)' }}>
          <h1 style={{ marginBottom: 4 }}>Forgot password</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            Enter your email and we'll let your admin know to issue a new temporary password.
          </p>
          <form onSubmit={onForgotSubmit}>
            <label>Email
              <input type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={forgotSubmitting || !email.trim()}>
                {forgotSubmitting ? 'Sending…' : 'Send request'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setForgotMode(null)} disabled={forgotSubmitting}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    );
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

  if (mfaChallenge) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ width: 'min(420px, 92vw)' }}>
          <h1 style={{ marginBottom: 4 }}>Verification code</h1>
          <p className="muted" style={{ marginTop: 0 }}>Enter the code for <strong>{mfaChallenge.email}</strong>.</p>
          <form onSubmit={onMfaSubmit}>
            <label>{useRecovery ? 'Recovery code' : 'Authenticator code'}
              <input
                type="text"
                autoFocus
                required
                inputMode={useRecovery ? 'text' : 'numeric'}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
              />
            </label>
            {error && <p className="error">{error}</p>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Verifying…' : 'Verify'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={submitting}
                onClick={() => { setUseRecovery((v) => !v); setMfaCode(''); setError(null); }}
              >
                {useRecovery ? 'Use app code' : 'Use recovery code'}
              </button>
            </div>
          </form>
          <button
            className="btn btn-ghost"
            onClick={() => { setMfaChallenge(null); setPassword(''); setError(null); }}
            style={{ marginTop: 8 }}
          >
            ← Back
          </button>
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
          {error && <p className="error">{error}</p>}
          <div style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border-subtle, #2a2a2a)' }} />
          <span className="muted" style={{ fontSize: 11 }}>OR</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border-subtle, #2a2a2a)' }} />
        </div>
        <GoogleSignInButton onCredential={handleGoogleCredential} />
        <p className="muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 8 }}>
          Google sign-in only works if your email is already registered as an admin or user.
        </p>
      </div>
    </div>
  );
}
