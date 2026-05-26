import { useState, type FormEvent } from 'react';
import { updateBucketUser, type BucketSummary, type BucketUser } from '../api';
import { FormModalShell, CoreFields, DynamicField } from './AddUserModal';

interface Props {
  clientId: string;
  bucket: BucketSummary;
  user: BucketUser;
  onClose: () => void;
  onSaved: () => void;
}

function initialFromUser(bucket: BucketSummary, user: BucketUser): Record<string, unknown> {
  const vals: Record<string, unknown> = {
    display_name: user.display_name,
    email: user.email ?? '',
    phone: user.phone ?? '',
    notes: user.notes ?? '',
  };
  for (const c of bucket.columns) {
    vals[c.key] = user[c.key] ?? (c.type === 'boolean' ? false : '');
  }
  return vals;
}

export function EditUserModal({ clientId, bucket, user, onClose, onSaved }: Props) {
  const [values, setValues] = useState(() => initialFromUser(bucket, user));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setField(k: string, v: unknown) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      payload[k] = v === '' ? null : v;
    }

    const r = await updateBucketUser(clientId, bucket.role, user.id, payload);
    setSubmitting(false);
    if (!r.ok) {
      setError(`Save failed: ${r.error.code}`);
      return;
    }
    onSaved();
  }

  return (
    <FormModalShell title={`Edit ${user.display_name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <CoreFields values={values} setField={setField} />
        {bucket.columns.map((c) => (
          <DynamicField key={c.key} column={c} value={values[c.key]} setValue={(v) => setField(c.key, v)} />
        ))}
        {error && <p className="error">{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </FormModalShell>
  );
}
