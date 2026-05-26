import { useEffect, useState, type FormEvent } from 'react';
import {
  getBucketUserCredential, resetBucketUserCredential, deleteBucketUserCredential,
  type BucketUserCredentialStatus, type BucketUser,
} from '../api';
import { generateTempPassword } from '../../../lib/random-password';
import { FormModalShell, CredentialRevealRow } from './AddUserModal';

interface Props {
  clientId: string;
  clientSlug: string;
  role: string;
  user: BucketUser;
  onClose: () => void;
  onChanged: () => void;
}

// Single modal that surfaces the right control depending on credential state:
//   - no credential yet → "Create login" w/ generated temp pwd
//   - credential exists w/ plaintext still revealable → show URL + email + pwd + views_left
//   - credential exists w/ plaintext wiped → "Reset password" w/ generated temp pwd
// Plus a "Remove login" button when credential exists.
export function LoginManageModal({ clientId, clientSlug, role, user, onClose, onChanged }: Props) {
  const [status, setStatus] = useState<BucketUserCredentialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState(() => generateTempPassword());
  const [submitting, setSubmitting] = useState(false);
  // After a fresh reset, surface the new plaintext immediately rather than
  // requiring a re-fetch (which would also decrement the reveal counter).
  const [justSetPassword, setJustSetPassword] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const r = await getBucketUserCredential(clientId, role, user.id);
    setLoading(false);
    if (!r.ok) {
      setError(`Failed to load (${r.error.code}).`);
      return;
    }
    setStatus(r.data);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const loginUrl = `${window.location.origin}/c/${clientSlug}/login`;
  const hasEmail = !!user.email;

  async function handleCreateOrReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!hasEmail) { setError('User has no email on file. Edit the user to add one first.'); return; }
    if (tempPassword.length < 8) { setError('Temporary password must be at least 8 characters.'); return; }
    setSubmitting(true);
    const r = await resetBucketUserCredential(clientId, role, user.id, tempPassword);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'email_already_has_login_in_this_client'
        ? 'This email already has a login in this client under a different bucket.'
        : `Failed (${r.error.code}).`);
      return;
    }
    setJustSetPassword(tempPassword);
    onChanged();
    await load();
  }

  async function handleRemove() {
    if (!confirm('Remove this user\'s login? Their bucket row stays; only the credential is deleted.')) return;
    setSubmitting(true);
    const r = await deleteBucketUserCredential(clientId, role, user.id);
    setSubmitting(false);
    if (!r.ok) { setError(`Failed (${r.error.code}).`); return; }
    onChanged();
    await load();
    setJustSetPassword(null);
  }

  return (
    <FormModalShell title={`Login — ${user.display_name}`} onClose={onClose}>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && status && (
        <>
          {status.has_credential ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                {status.last_login_at
                  ? `Last login ${new Date(status.last_login_at).toLocaleString()}`
                  : 'Has not signed in yet.'}
                {status.must_change_password && ' Must change password on next login.'}
              </p>
              <CredentialRevealRow label="Login URL" value={loginUrl} />
              <CredentialRevealRow label="Email" value={status.email ?? user.email ?? ''} />
              {justSetPassword ? (
                <CredentialRevealRow label="Temp password (just set)" value={justSetPassword} mono />
              ) : status.temp_password_plain ? (
                <>
                  <CredentialRevealRow label="Temp password" value={status.temp_password_plain} mono />
                  <p className="muted" style={{ fontSize: 12 }}>
                    Views remaining: {status.temp_password_views_left}. After 0 views or once the user changes the password, this won't be shown again.
                  </p>
                </>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>
                  Temporary password is no longer viewable (user has changed it OR view limit reached). You can reset to issue a new one.
                </p>
              )}

              <fieldset style={{ border: '1px solid var(--border-subtle)', borderRadius: 6, padding: 12, marginTop: 12 }}>
                <legend style={{ fontSize: 12 }}>Reset password</legend>
                <form onSubmit={handleCreateOrReset}>
                  <label>New temporary password
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text" value={tempPassword} minLength={8}
                        onChange={(e) => setTempPassword(e.target.value)}
                        style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                      />
                      <button type="button" className="btn btn-ghost" onClick={() => setTempPassword(generateTempPassword())}>
                        Regenerate
                      </button>
                    </div>
                  </label>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <button type="button" className="btn btn-ghost" onClick={handleRemove} disabled={submitting}>
                      Remove login
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                      {submitting ? 'Saving…' : 'Reset password'}
                    </button>
                  </div>
                </form>
              </fieldset>
            </>
          ) : (
            <form onSubmit={handleCreateOrReset}>
              <p className="muted" style={{ marginTop: 0 }}>
                {hasEmail
                  ? 'This user does not have a login yet. Set a temporary password to create one.'
                  : 'This user has no email on file. Edit the user to add an email first.'}
              </p>
              <CredentialRevealRow label="Login URL" value={loginUrl} />
              <CredentialRevealRow label="Email" value={user.email ?? '—'} />
              <label>Temporary password
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text" value={tempPassword} minLength={8}
                    onChange={(e) => setTempPassword(e.target.value)}
                    disabled={!hasEmail}
                    style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                  />
                  <button type="button" className="btn btn-ghost" onClick={() => setTempPassword(generateTempPassword())} disabled={!hasEmail}>
                    Regenerate
                  </button>
                </div>
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="submit" className="btn btn-primary" disabled={submitting || !hasEmail}>
                  {submitting ? 'Creating…' : 'Create login'}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </FormModalShell>
  );
}
