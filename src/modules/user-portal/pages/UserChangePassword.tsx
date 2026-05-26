import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { userChangePassword } from '../api';
import { useUserAuth } from '../user-auth-context';
import { PageShell } from './UserLogin';

export default function UserChangePassword() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user, refresh } = useUserAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirm) { setError('Passwords do not match.'); return; }
    if (newPassword === currentPassword) { setError('New password must differ from current.'); return; }
    setSubmitting(true);
    const r = await userChangePassword(currentPassword, newPassword);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'current_password_incorrect'
        ? 'Current password is incorrect.'
        : `Failed (${r.error.code}).`);
      return;
    }
    await refresh();
    navigate(`/c/${slug}`, { replace: true });
  }

  return (
    <PageShell>
      <h1 style={{ marginBottom: 4 }}>Set a new password</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {user?.must_change_password
          ? 'You must change your password before continuing.'
          : 'Update your password.'}
      </p>
      <form onSubmit={handleSubmit}>
        <label>Current password
          <input type="password" autoFocus required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </label>
        <label>New password
          <input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        <label>Confirm new password
          <input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <div style={{ marginTop: 12 }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Update password'}
          </button>
        </div>
      </form>
    </PageShell>
  );
}
