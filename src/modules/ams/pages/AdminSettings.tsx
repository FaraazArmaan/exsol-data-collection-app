import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../../lib/auth-context';
import {
  listAdminTeam, deleteAdmin, updateAdminSelf,
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

  useEffect(() => { setDisplayName(admin?.display_name ?? ''); }, [admin?.display_name]);

  async function loadTeam() {
    setTeamLoading(true);
    setTeamError(null);
    const r = await listAdminTeam();
    setTeamLoading(false);
    if (!r.ok) { setTeamError(`Failed to load admins (${r.error.code}).`); return; }
    setTeam(r.data.admins);
  }

  useEffect(() => { void loadTeam(); }, []);

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
                <tr><td colSpan={4} className="muted" style={{ padding: 12 }}>No admins.</td></tr>
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
