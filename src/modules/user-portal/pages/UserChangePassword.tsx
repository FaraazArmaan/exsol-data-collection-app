import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { userChangePassword } from '../api';
import { useUserAuth } from '../user-auth-context';
import { PageShell } from './UserLogin';
import { Button } from '../../../components/ui/Button';
import { InlineNotice } from '../../../components/ui/Feedback';
import { Field, Input } from '../../../components/ui/Field';

export default function UserChangePassword() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user, refresh } = useUserAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const values = new FormData(e.currentTarget);
    const current = String(values.get('current-password') ?? '');
    const next = String(values.get('new-password') ?? '');
    const confirmation = String(values.get('confirm-password') ?? '');
    if (next.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (next !== confirmation) { setError('Passwords do not match.'); return; }
    if (next === current) { setError('New password must differ from current.'); return; }
    setSubmitting(true);
    const r = await userChangePassword(current, next);
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
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Current password" required>
            {(props) => <Input {...props} name="current-password" type="password" autoComplete="current-password" autoFocus required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />}
          </Field>
          <Field label="New password" required>
            {(props) => <Input {...props} name="new-password" type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />}
          </Field>
          <Field label="Confirm new password" required>
            {(props) => <Input {...props} name="confirm-password" type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
          </Field>
        </div>
        {error && <InlineNotice tone="danger" title="Password was not updated">{error}</InlineNotice>}
        <div style={{ marginTop: 12 }}>
          <Button type="submit" variant="primary" loading={submitting} loadingLabel="Saving…">Update password</Button>
        </div>
      </form>
    </PageShell>
  );
}
