import { useEffect, useState, type FormEvent } from 'react';
import {
  patchUserNode, deleteUserNode, peekUserNodeCredential,
  resetUserNodeCredential,
  type ClientRole, type UserNode, type UserNodeCredentialStatus,
} from '../api';
import { generateTempPassword } from '../../../lib/random-password';

interface Props {
  node: UserNode;
  role: ClientRole | undefined;
  clientSlug: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onManageLogin: () => void;
}

// Edit the identity-level fields of a user node (display_name, email, phone,
// notes + any role-defined custom fields). Also shows a Sign-in summary
// (password / Google / last login) and a one-click Reset password action.
// Deep "manage credential" flows (reveal counter, remove login) live in
// LoginManageModal — this modal exposes a button to hand off to it.
export function EditUserNodeModal({ node, role, clientSlug, onClose, onSaved, onDeleted, onManageLogin }: Props) {
  const [displayName, setDisplayName] = useState(node.display_name);
  const [email, setEmail] = useState(node.email ?? '');
  const [phone, setPhone] = useState(node.phone ?? '');
  const [notes, setNotes] = useState(node.notes ?? '');
  const [fields, setFields] = useState<Record<string, unknown>>(node.fields ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sign-in status (peeked — does NOT decrement reveal counter).
  const [status, setStatus] = useState<UserNodeCredentialStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // After a Reset password success, hold the newly-issued temp pwd inline
  // so the admin can copy it without re-opening LoginManageModal.
  const [resetResult, setResetResult] = useState<null | { tempPassword: string; email: string }>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatusLoading(true);
      const r = await peekUserNodeCredential(node.id);
      if (cancelled) return;
      setStatusLoading(false);
      if (r.ok) setStatus(r.data);
    })();
    return () => { cancelled = true; };
  }, [node.id]);

  const dirty =
    displayName.trim() !== node.display_name ||
    (email.trim() || null) !== (node.email ?? null) ||
    (phone.trim() || null) !== (node.phone ?? null) ||
    (notes.trim() || null) !== (node.notes ?? null) ||
    JSON.stringify(fields) !== JSON.stringify(node.fields ?? {});

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!displayName.trim()) { setError('Display name is required.'); return; }
    if (!dirty) { onClose(); return; }
    setSubmitting(true);
    const r = await patchUserNode(node.id, {
      display_name: displayName.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      notes: notes.trim() || null,
      fields,
    });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'email_already_has_login_in_this_client'
        ? 'Email is already taken by another user in this client.'
        : `Failed (${r.error.code}).`);
      return;
    }
    onSaved();
  }

  async function handleDelete() {
    const labelHint = role?.label ? ` (${role.label})` : '';
    if (!confirm(`Delete ${node.display_name}${labelHint}? This also removes their login if any.`)) return;
    setSubmitting(true);
    const r = await deleteUserNode(node.id);
    if (!r.ok && r.error.code === 'has_children') {
      setSubmitting(false);
      if (!confirm('This user has children in the tree. Delete them and all descendants?')) return;
      setSubmitting(true);
      const r2 = await deleteUserNode(node.id, true);
      setSubmitting(false);
      if (!r2.ok) { setError(`Failed (${r2.error.code}).`); return; }
      onDeleted();
      return;
    }
    setSubmitting(false);
    if (!r.ok) { setError(`Failed (${r.error.code}).`); return; }
    onDeleted();
  }

  async function handleResetPassword() {
    setError(null);
    const tempPw = generateTempPassword();
    setSubmitting(true);
    const r = await resetUserNodeCredential(node.id, tempPw);
    setSubmitting(false);
    setConfirmingReset(false);
    if (!r.ok) {
      setError(r.error.code === 'email_already_has_login_in_this_client'
        ? 'Email is already taken by another login in this client.'
        : `Failed (${r.error.code}).`);
      return;
    }
    setResetResult({ tempPassword: tempPw, email: status?.email ?? node.email ?? '' });
    // Re-peek so the panel reflects the now-set password and cleared last_login.
    const s = await peekUserNodeCredential(node.id);
    if (s.ok) setStatus(s.data);
  }

  async function handleCopyPassword() {
    if (!resetResult) return;
    try {
      await navigator.clipboard.writeText(resetResult.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked (insecure context / permissions). Password is
      // still visible in the readonly input — admin can select-and-copy manually.
    }
  }

  const loginUrl = `${window.location.origin}/c/${clientSlug}/login`;
  const roleSwatch = role?.color ?? '#888';

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: roleSwatch }} />
          <h2 style={{ margin: 0, fontSize: 18 }}>Edit {node.display_name}</h2>
          {role && <span className="muted" style={{ fontSize: 12 }}>{role.label}</span>}
        </header>

        <form onSubmit={handleSave}>
          <label>Display name *
            <input type="text" required autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>Phone
            <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>Notes
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          {role && role.fields.map((f) => (
            <label key={f.key}>{f.label}{f.required && ' *'}
              {f.type === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={Boolean(fields[f.key])}
                  onChange={(e) => setFields({ ...fields, [f.key]: e.target.checked })}
                />
              ) : (
                <input
                  type={f.type === 'integer' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  required={f.required}
                  value={String(fields[f.key] ?? '')}
                  onChange={(e) =>
                    setFields({
                      ...fields,
                      [f.key]: f.type === 'integer' ? Number(e.target.value) : e.target.value,
                    })
                  }
                />
              )}
            </label>
          ))}

          <section style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border, #2a2a2a)' }}>
            <strong style={{ fontSize: 13 }}>Sign-in</strong>

            {statusLoading && <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>Loading…</p>}

            {!statusLoading && !status?.has_credential && (
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
                No login set up yet — use <em>Manage login</em> below to create one.
              </p>
            )}

            {!statusLoading && status?.has_credential && (
              <>
                {status.password_reset_requested_at && !resetResult && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      fontSize: 12,
                    }}
                  >
                    🔔 <strong>User requested a password reset</strong>{' '}
                    <span className="muted">
                      ({new Date(status.password_reset_requested_at).toLocaleString()})
                    </span>
                    <br />
                    <span className="muted" style={{ fontSize: 11 }}>
                      Issue a new temp password below and share it out-of-band.
                    </span>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12, marginTop: 6 }}>
                  <span className="muted">Email</span><span>{status.email ?? '—'}</span>
                  <span className="muted">Password</span><span>{status.has_password ? '✓ set' : '— not set'}</span>
                  <span className="muted">Google</span><span>{status.has_google ? '✓ linked' : '— not linked'}</span>
                  <span className="muted">Last login</span>
                  <span>{status.last_login_at ? new Date(status.last_login_at).toLocaleString() : 'Never'}</span>
                </div>

                {resetResult ? (
                  <div style={{ marginTop: 10, padding: 10, background: 'var(--surface-2, rgba(255,255,255,0.04))', borderRadius: 6 }}>
                    <p className="muted" style={{ margin: '0 0 6px', fontSize: 11 }}>
                      New temp password — share with {resetResult.email || 'the user'}. They'll be prompted to change it on first sign-in.
                    </p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        readOnly
                        value={resetResult.tempPassword}
                        style={{ fontFamily: 'monospace', flex: 1 }}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <button type="button" className="btn btn-ghost" onClick={handleCopyPassword}>
                        {copied ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="muted" style={{ margin: '6px 0 0', fontSize: 11 }}>Login URL: {loginUrl}</p>
                  </div>
                ) : confirmingReset ? (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexWrap: 'wrap' }}>
                    <span>Replace existing password with a new temp one?</span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ color: 'var(--danger, #ef4444)' }}
                      onClick={handleResetPassword}
                      disabled={submitting}
                    >
                      {submitting ? '…' : 'Confirm reset'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmingReset(false)} disabled={submitting}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ marginTop: 10, fontSize: 12 }}
                    onClick={() => setConfirmingReset(true)}
                    disabled={submitting || !status.email}
                    title={!status.email ? 'Add an email to the user first' : 'Issue a new temp password'}
                  >
                    Reset password
                  </button>
                )}
              </>
            )}
          </section>

          {error && <p className="error">{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-ghost" onClick={onManageLogin} disabled={submitting} title="Open login management for this user">
                🔑 Manage login
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleDelete} disabled={submitting} style={{ color: 'var(--danger, #ef4444)' }}>
                × Delete user
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting || !dirty}>
                {submitting ? '…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
