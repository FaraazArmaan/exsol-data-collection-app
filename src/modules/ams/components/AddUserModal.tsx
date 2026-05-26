import { useState, type FormEvent } from 'react';
import { addBucketUser, type BucketSummary, type BucketColumn } from '../api';
import { generateTempPassword } from '../../../lib/random-password';

interface Props {
  clientId: string;
  bucket: BucketSummary;
  onClose: () => void;
  onCreated: () => void;
}

// Build the initial form state — core columns blank, custom columns get their defaults.
function initialValues(bucket: BucketSummary): Record<string, unknown> {
  const vals: Record<string, unknown> = {
    display_name: '',
    email: '',
    phone: '',
    notes: '',
  };
  for (const c of bucket.columns) {
    vals[c.key] = c.default ?? (c.type === 'boolean' ? false : '');
  }
  return vals;
}

interface Props2 extends Props { clientSlug?: string }

export function AddUserModal({ clientId, bucket, onClose, onCreated, clientSlug }: Props2) {
  const [values, setValues] = useState(() => initialValues(bucket));
  const [createLogin, setCreateLogin] = useState(false);
  const [tempPassword, setTempPassword] = useState(() => generateTempPassword());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [postCreate, setPostCreate] = useState<null | { tempPassword: string; email: string }>(null);

  function setField(k: string, v: unknown) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  const hasEmail = typeof values.email === 'string' && (values.email as string).trim().length > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    if (createLogin && !hasEmail) {
      setSubmitting(false);
      setError('Email is required when creating a login.');
      return;
    }
    if (createLogin && tempPassword.length < 8) {
      setSubmitting(false);
      setError('Temporary password must be at least 8 characters.');
      return;
    }

    // Normalize empty strings to null for optional fields so the server sees a true absence.
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      payload[k] = v === '' ? null : v;
    }
    if (createLogin) {
      payload.create_login = true;
      payload.temp_password = tempPassword;
    }

    const r = await addBucketUser(clientId, bucket.role, payload);
    setSubmitting(false);
    if (!r.ok) {
      if (r.error.code === 'conflict') {
        setError('This singleton role is already filled.');
      } else if (r.error.code === 'email_already_has_login_in_this_client') {
        setError('This email already has a login in this client. Use Reset password on the existing row instead.');
      } else if (r.error.code === 'validation_failed') {
        setError(`Validation failed: ${typeof r.error.details === 'string' ? r.error.details : 'check required fields'}`);
      } else {
        setError(`Save failed: ${r.error.code}`);
      }
      return;
    }
    if (createLogin && r.data.login_created) {
      setPostCreate({ tempPassword, email: String(values.email) });
      return;
    }
    onCreated();
  }

  if (postCreate) {
    const loginUrl = clientSlug
      ? `${window.location.origin}/c/${clientSlug}/login`
      : `${window.location.origin}/c/<slug>/login`;
    return (
      <FormModalShell title="Login created" onClose={() => { onCreated(); }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Share this with the user. They'll be prompted to change the password on first login.
          You can re-view the password up to 3 times from this user's row.
        </p>
        <CredentialRevealRow label="Login URL" value={loginUrl} />
        <CredentialRevealRow label="Email" value={postCreate.email} />
        <CredentialRevealRow label="Temp password" value={postCreate.tempPassword} mono />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-primary" onClick={() => onCreated()}>Done</button>
        </div>
      </FormModalShell>
    );
  }

  return (
    <FormModalShell title={`Add ${bucket.label}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <CoreFields values={values} setField={setField} />
        {bucket.columns.map((c) => (
          <DynamicField key={c.key} column={c} value={values[c.key]} setValue={(v) => setField(c.key, v)} />
        ))}

        <fieldset style={{ border: '1px solid var(--border-subtle)', borderRadius: 6, padding: 12, marginTop: 12 }}>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={createLogin}
              onChange={(e) => setCreateLogin(e.target.checked)}
              disabled={!hasEmail}
            />
            <span>Create login for this user</span>
          </label>
          {!hasEmail && (
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
              Fill in an email above to enable.
            </p>
          )}
          {createLogin && hasEmail && (
            <div style={{ marginTop: 8 }}>
              <label>Temporary password
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                    style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                    minLength={8}
                  />
                  <button type="button" className="btn btn-ghost" onClick={() => setTempPassword(generateTempPassword())}>
                    Regenerate
                  </button>
                </div>
              </label>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
                User will be forced to change this on first login. You'll be able to re-view it up to 3 times.
              </p>
            </div>
          )}
        </fieldset>

        {error && <p className="error">{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
    </FormModalShell>
  );
}

export function CredentialRevealRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard might be unavailable in non-secure contexts; user can select manually
    }
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <code style={{
          flex: 1, padding: '6px 8px', border: '1px solid var(--border-subtle)', borderRadius: 4,
          fontFamily: mono ? 'var(--font-mono)' : undefined, fontSize: mono ? 14 : 13,
          background: 'var(--bg-elevated, #1a1a1a)', wordBreak: 'break-all',
        }}>{value}</code>
        <button type="button" className="btn btn-ghost" onClick={copy}>{copied ? '✓ copied' : 'copy'}</button>
      </div>
    </div>
  );
}

// Reusable form modal chrome (also used by EditUserModal — extracted for reuse).
export function FormModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Core fields shown for every bucket regardless of template.
export function CoreFields({ values, setField }: { values: Record<string, unknown>; setField: (k: string, v: unknown) => void }) {
  return (
    <>
      <label>Name <span style={{ color: 'var(--danger)' }}>*</span>
        <input type="text" required autoFocus value={String(values.display_name ?? '')} onChange={(e) => setField('display_name', e.target.value)} />
      </label>
      <label>Email
        <input type="email" value={String(values.email ?? '')} onChange={(e) => setField('email', e.target.value)} />
      </label>
      <label>Phone
        <input type="text" value={String(values.phone ?? '')} onChange={(e) => setField('phone', e.target.value)} />
      </label>
      <label>Notes
        <textarea rows={2} value={String(values.notes ?? '')} onChange={(e) => setField('notes', e.target.value)} />
      </label>
    </>
  );
}

// Dynamic field — renders the right input type based on column.type, plus required/help affordances.
export function DynamicField({ column, value, setValue }: { column: BucketColumn; value: unknown; setValue: (v: unknown) => void }) {
  const labelEl = (
    <>
      {column.label}
      {column.required && <span style={{ color: 'var(--danger)' }}> *</span>}
      {column.help && <span title={column.help} style={{ marginLeft: 4, color: 'var(--text-muted)', cursor: 'help' }}>?</span>}
    </>
  );

  if (column.type === 'boolean') {
    return (
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => setValue(e.target.checked)} />
        {labelEl}
      </label>
    );
  }
  if (column.type === 'date') {
    return (
      <label>{labelEl}
        <input
          type="date"
          required={column.required}
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(e) => setValue(e.target.value || null)}
        />
      </label>
    );
  }
  if (column.type === 'integer') {
    return (
      <label>{labelEl}
        <input
          type="number"
          step="1"
          required={column.required}
          value={value === null || value === undefined || value === '' ? '' : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            setValue(raw === '' ? null : Number.parseInt(raw, 10));
          }}
        />
      </label>
    );
  }
  // default text
  return (
    <label>{labelEl}
      <input
        type="text"
        required={column.required}
        value={String(value ?? '')}
        onChange={(e) => setValue(e.target.value)}
      />
    </label>
  );
}
