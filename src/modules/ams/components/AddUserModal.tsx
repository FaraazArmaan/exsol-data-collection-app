import { useState, type FormEvent } from 'react';
import { addBucketUser, type BucketSummary, type BucketColumn } from '../api';

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

export function AddUserModal({ clientId, bucket, onClose, onCreated }: Props) {
  const [values, setValues] = useState(() => initialValues(bucket));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setField(k: string, v: unknown) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Normalize empty strings to null for optional fields so the server sees a true absence.
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      payload[k] = v === '' ? null : v;
    }

    const r = await addBucketUser(clientId, bucket.role, payload);
    setSubmitting(false);
    if (!r.ok) {
      if (r.error.code === 'conflict') {
        setError('This singleton role is already filled.');
      } else if (r.error.code === 'validation_failed') {
        setError(`Validation failed: ${typeof r.error.details === 'string' ? r.error.details : 'check required fields'}`);
      } else {
        setError(`Save failed: ${r.error.code}`);
      }
      return;
    }
    onCreated();
  }

  return (
    <FormModalShell title={`Add ${bucket.label}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <CoreFields values={values} setField={setField} />
        {bucket.columns.map((c) => (
          <DynamicField key={c.key} column={c} value={values[c.key]} setValue={(v) => setField(c.key, v)} />
        ))}
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
