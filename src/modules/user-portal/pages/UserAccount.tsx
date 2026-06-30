import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUserAuth } from '../user-auth-context';
import { GoogleSignInButton } from '../../../lib/google-signin';
import { userLinkGoogle, userUnlinkGoogle } from '../api';
import WorkspaceExportCard from '../../ams/components/settings/WorkspaceExportCard';

export default function UserAccount() {
  const { slug } = useParams<{ slug: string }>();
  const { user, refresh } = useUserAuth();

  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkOk, setLinkOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleLinkGoogle = useCallback(async (idToken: string) => {
    setLinkError(null); setLinkOk(null); setBusy(true);
    const r = await userLinkGoogle(idToken);
    setBusy(false);
    if (!r.ok) {
      const code = r.error.code;
      setLinkError(
        code === 'google_email_mismatch' ? 'That Google account uses a different email than your registered one.'
        : code === 'google_already_linked' ? 'A different Google account is already linked. Unlink it first.'
        : code === 'google_already_claimed_in_this_workspace' ? 'Another user in this workspace already linked that Google account.'
        : code === 'google_token_invalid' || code === 'google_email_unverified' ? 'Google sign-in failed.'
        : `Failed (${code}).`,
      );
      return;
    }
    setLinkOk('Google account linked. You can now sign in with Google.');
    await refresh();
  }, [refresh]);

  async function handleUnlink() {
    if (!confirm('Unlink your Google account from this profile? You will still be able to sign in with email + password.')) return;
    setLinkError(null); setLinkOk(null); setBusy(true);
    const r = await userUnlinkGoogle();
    setBusy(false);
    if (!r.ok) {
      setLinkError(r.error.code === 'cannot_unlink_only_credential'
        ? 'Cannot unlink — Google is your only sign-in method. Set a password first (change-password), then try again.'
        : `Failed (${r.error.code}).`);
      return;
    }
    setLinkOk('Google unlinked.');
    await refresh();
  }

  if (!user) return null;

  return (
    <div className="page-tight">
      <h1 className="page-title" style={{ marginBottom: 24 }}>Account</h1>

      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>Your account</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Email: <strong>{user.email}</strong>
        </p>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
          Role: <strong>{user.role.label}</strong>
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>Sign-in methods</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Email + password is always available.
        </p>
        <div style={{ marginTop: 10 }}>
          {user.has_google ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13 }}>✓ Google account is linked.</span>
              <button className="btn btn-ghost" onClick={handleUnlink} disabled={busy}>
                Unlink Google
              </button>
            </div>
          ) : (
            <div>
              <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
                Link your Google account so you can sign in with one click.
              </p>
              <GoogleSignInButton onCredential={handleLinkGoogle} text="continue_with" />
            </div>
          )}
          {linkOk && <p className="muted" style={{ marginTop: 8, fontSize: 12, color: 'var(--success, #22c55e)' }}>{linkOk}</p>}
          {linkError && <p className="error" style={{ marginTop: 8 }}>{linkError}</p>}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Link to={`/c/${slug}/change-password`} className="btn btn-secondary">Change password</Link>
      </div>

      <WorkspaceExportCard />
    </div>
  );
}
