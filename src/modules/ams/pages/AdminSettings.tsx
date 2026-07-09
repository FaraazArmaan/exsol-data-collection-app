import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../../lib/auth-context';
import {
  listAdminTeam, deleteAdmin, updateAdminSelf,
  getAdminMfaStatus, startAdminMfaEnroll, confirmAdminMfaEnroll, disableAdminMfa,
  type AdminMfaStatus,
  type AdminMember,
} from '../api';
import { AddAdminModal } from '../components/AddAdminModal';

export default function AdminSettings() {
  const { admin, signOut, refresh } = useAuth();

  const [team, setTeam] = useState<AdminMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // self-edit form
  const [displayName, setDisplayName] = useState(admin?.display_name ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [selfMsg, setSelfMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [selfSubmitting, setSelfSubmitting] = useState(false);

  const [mfaStatus, setMfaStatus] = useState<AdminMfaStatus | null>(null);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaOtpUrl, setMfaOtpUrl] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[] | null>(null);
  const [mfaMsg, setMfaMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [mfaSubmitting, setMfaSubmitting] = useState(false);

  useEffect(() => { setDisplayName(admin?.display_name ?? ''); }, [admin?.display_name]);

  async function loadMfaStatus() {
    setMfaLoading(true);
    const r = await getAdminMfaStatus();
    setMfaLoading(false);
    if (r.ok) setMfaStatus(r.data);
  }

  async function loadTeam() {
    setTeamLoading(true);
    setTeamError(null);
    const r = await listAdminTeam();
    setTeamLoading(false);
    if (!r.ok) { setTeamError(`Failed to load admins (${r.error.code}).`); return; }
    setTeam(r.data.admins);
  }

  useEffect(() => { void loadTeam(); void loadMfaStatus(); }, []);

  async function handleSelfSubmit(e: FormEvent) {
    e.preventDefault();
    setSelfMsg(null);

    const trimmed = displayName.trim();
    const changedName = trimmed && trimmed !== admin?.display_name;
    const changedPw = newPassword.length > 0;
    if (!changedName && !changedPw) {
      setSelfMsg({ kind: 'err', text: 'Nothing to update.' });
      return;
    }
    if (changedPw && newPassword.length < 8) {
      setSelfMsg({ kind: 'err', text: 'Password must be at least 8 characters.' });
      return;
    }

    setSelfSubmitting(true);
    const r = await updateAdminSelf({
      display_name: changedName ? trimmed : undefined,
      password: changedPw ? newPassword : undefined,
    });
    setSelfSubmitting(false);

    if (!r.ok) {
      setSelfMsg({ kind: 'err', text: `Failed to update (${r.error.code}).` });
      return;
    }
    setSelfMsg({ kind: 'ok', text: 'Account updated.' });
    setNewPassword('');
    await refresh();
    await loadTeam();
  }

  async function handleDeleteAdmin(member: AdminMember) {
    if (member.is_bootstrap) return;
    if (member.id === admin?.id) return;
    if (!confirm(`Remove ${member.display_name} (${member.email})?`)) return;
    const r = await deleteAdmin(member.id);
    if (!r.ok) {
      alert(`Failed to remove: ${r.error.code}`);
      return;
    }
    await loadTeam();
  }

  async function handleStartMfa() {
    setMfaMsg(null);
    setMfaSubmitting(true);
    const r = await startAdminMfaEnroll();
    setMfaSubmitting(false);
    if (!r.ok) {
      setMfaMsg({ kind: 'err', text: `Failed to start MFA setup (${r.error.code}).` });
      return;
    }
    setMfaSecret(r.data.secret);
    setMfaOtpUrl(r.data.otpauth_url);
    setMfaRecoveryCodes(null);
    setMfaCode('');
  }

  async function handleConfirmMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaCode.trim()) return;
    setMfaMsg(null);
    setMfaSubmitting(true);
    const r = await confirmAdminMfaEnroll(mfaCode.trim());
    setMfaSubmitting(false);
    if (!r.ok) {
      setMfaMsg({ kind: 'err', text: 'Invalid verification code.' });
      return;
    }
    setMfaStatus({ enabled: true, recovery_codes_remaining: r.data.recovery_codes.length });
    setMfaRecoveryCodes(r.data.recovery_codes);
    setMfaSecret(null);
    setMfaOtpUrl(null);
    setMfaCode('');
    setMfaMsg({ kind: 'ok', text: 'MFA is enabled.' });
  }

  async function handleDisableMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaCode.trim()) return;
    setMfaMsg(null);
    setMfaSubmitting(true);
    const r = await disableAdminMfa({ code: mfaCode.trim() });
    setMfaSubmitting(false);
    if (!r.ok) {
      setMfaMsg({ kind: 'err', text: 'Invalid verification code.' });
      return;
    }
    setMfaStatus({ enabled: false, recovery_codes_remaining: 0 });
    setMfaCode('');
    setMfaRecoveryCodes(null);
    setMfaMsg({ kind: 'ok', text: 'MFA is disabled.' });
  }

  return (
    <section>
      <h1>Settings</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Your account</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Signed in as <strong>{admin?.email}</strong>
          {admin?.is_bootstrap && <span className="badge" style={{ marginLeft: 8 }}>bootstrap</span>}
        </p>
        <form onSubmit={handleSelfSubmit}>
          <label>Display name
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label>New password
            <input
              type="password"
              placeholder="leave blank to keep current"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          {selfMsg && (
            <p className={selfMsg.kind === 'ok' ? 'muted' : 'error'} style={{ marginTop: 8 }}>
              {selfMsg.text}
            </p>
          )}
          <div style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={selfSubmitting}>
              {selfSubmitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Multi-factor authentication</h3>
        {mfaLoading && <p className="muted">Loading…</p>}
        {!mfaLoading && !mfaStatus?.enabled && !mfaSecret && (
          <>
            <p className="muted">Protect your admin account with a 6-digit authenticator app code.</p>
            <button className="btn btn-primary" onClick={handleStartMfa} disabled={mfaSubmitting}>
              {mfaSubmitting ? 'Starting…' : 'Set up MFA'}
            </button>
          </>
        )}
        {mfaSecret && (
          <form onSubmit={handleConfirmMfa}>
            <p className="muted">Add this setup key to your authenticator app, then enter the current code.</p>
            <label>Setup key
              <input readOnly value={mfaSecret} onFocus={(e) => e.currentTarget.select()} />
            </label>
            {mfaOtpUrl && (
              <p className="muted" style={{ wordBreak: 'break-all', fontSize: 12 }}>
                {mfaOtpUrl}
              </p>
            )}
            <label>Authenticator code
              <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" />
            </label>
            <button className="btn btn-primary" disabled={mfaSubmitting || !mfaCode.trim()}>
              {mfaSubmitting ? 'Verifying…' : 'Enable MFA'}
            </button>
          </form>
        )}
        {!mfaLoading && mfaStatus?.enabled && !mfaSecret && (
          <form onSubmit={handleDisableMfa}>
            <p className="muted">
              MFA is enabled. Recovery codes remaining: {mfaStatus.recovery_codes_remaining}.
            </p>
            <label>Authenticator code
              <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" />
            </label>
            <button className="btn btn-ghost" disabled={mfaSubmitting || !mfaCode.trim()}>
              {mfaSubmitting ? 'Disabling…' : 'Disable MFA'}
            </button>
          </form>
        )}
        {mfaRecoveryCodes && (
          <div style={{ marginTop: 12 }}>
            <p className="muted">Save these recovery codes now. They will not be shown again.</p>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{mfaRecoveryCodes.join('\n')}</pre>
          </div>
        )}
        {mfaMsg && (
          <p className={mfaMsg.kind === 'ok' ? 'muted' : 'error'} style={{ marginTop: 8 }}>
            {mfaMsg.text}
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Admin team</h3>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add admin</button>
        </div>
        {teamLoading && <p className="muted">Loading…</p>}
        {teamError && <p className="error">{teamError}</p>}
        {!teamLoading && !teamError && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Name</th>
                <th style={{ padding: '6px 8px' }}>Email</th>
                <th style={{ padding: '6px 8px' }}>Role</th>
                <th style={{ padding: '6px 8px' }}>Sign-in</th>
                <th style={{ padding: '6px 8px', width: 1 }}></th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => {
                const isMe = m.id === admin?.id;
                const undeletable = m.is_bootstrap || isMe;
                return (
                  <tr key={m.id} style={{ borderTop: '1px solid var(--border, #2a2a2a)' }}>
                    <td style={{ padding: '8px' }}>
                      {m.display_name}
                      {isMe && <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>(you)</span>}
                      {m.is_bootstrap && <span className="badge" style={{ marginLeft: 6 }}>bootstrap</span>}
                    </td>
                    <td style={{ padding: '8px' }}>{m.email}</td>
                    <td style={{ padding: '8px', fontSize: 13 }} className="muted">{m.role.replace('_', ' ')}</td>
                    <td style={{ padding: '8px', fontSize: 13 }} className="muted">
                      {[m.has_password && 'password', m.has_google && 'google'].filter(Boolean).join(' + ') || '—'}
                    </td>
                    <td style={{ padding: '8px' }}>
                      <button
                        className="btn btn-ghost"
                        disabled={undeletable}
                        title={
                          m.is_bootstrap ? 'Cannot delete bootstrap admin'
                          : isMe ? 'Cannot delete yourself'
                          : 'Remove admin'
                        }
                        onClick={() => handleDeleteAdmin(m)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
              {team.length === 0 && (
                <tr><td colSpan={5} className="muted" style={{ padding: 12 }}>No admins.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Danger zone</h3>
        <button className="btn btn-ghost" onClick={() => { void signOut(); }}>Sign out</button>
      </div>

      {showAdd && (
        <AddAdminModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { void loadTeam(); }}
        />
      )}
    </section>
  );
}
