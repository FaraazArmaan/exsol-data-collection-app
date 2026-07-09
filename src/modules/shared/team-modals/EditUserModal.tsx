// Shared Edit-User modal. See ./types.ts for the api/copy contract.

import { useEffect, useState, type FormEvent } from 'react';
import type { ClientRole, ClientLevel, UserNode, UserNodeCredentialStatus } from '../../ams/api';
import type { TeamMemberApi, TeamMemberCopy, TeamMemberCaps } from './types';

interface Props {
  api: TeamMemberApi;
  copy: TeamMemberCopy;
  caps: TeamMemberCaps;
  node: UserNode;
  role: ClientRole | undefined;
  roles: ClientRole[];
  levels: ClientLevel[];
  // The user_node id of the currently-signed-in caller, when the caller is a
  // bucket_user (owner). Null for admin callers (who aren't user nodes). Used
  // to forbid self-role-change on the client side.
  callerUserNodeId: string | null;
  clientSlug: string;
  // All user nodes in the workspace. Used to populate the Parent picker with
  // siblings at the level above this node. Pass an empty array if the caller
  // doesn't want to expose the parent-change UI.
  nodes: UserNode[];
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
export function EditUserModal({
  api, copy, caps, node, role, roles, levels, callerUserNodeId,
  clientSlug, nodes, onClose, onSaved, onDeleted, onManageLogin,
}: Props) {
  const [displayName, setDisplayName] = useState(node.display_name);
  const [email, setEmail] = useState(node.email ?? '');
  const [phone, setPhone] = useState(node.phone ?? '');
  const [notes, setNotes] = useState(node.notes ?? '');
  const [fields, setFields] = useState<Record<string, unknown>>(node.fields ?? {});
  const [parentId, setParentId] = useState<string | null>(node.parent_id ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parent picker is only meaningful for nodes that already sit under someone
  // (L2+). L1 nodes have no parent by definition; unassigned nodes have neither
  // level nor parent. To move into/out of those states, use drag-drop on the
  // dashboard.
  const parentCandidates =
    node.level_number !== null && node.level_number > 1
      ? nodes.filter((n) => n.level_number === node.level_number! - 1)
      : [];

  // Picker shows ALL roles in the workspace. Level no longer constrains role —
  // a role's level-applicability is now considered part of the role itself
  // (a future refactor will remove `client_levels.allowed_role_ids` entirely).
  const pickableRoles = roles;

  const isSelfTarget = callerUserNodeId !== null && callerUserNodeId === node.id;
  const rolePickerVisible = caps.canChangeRole && node.level_number !== null;
  const rolePickerDisabled = isSelfTarget;

  const [selectedRoleId, setSelectedRoleId] = useState<string>(node.role_id);
  const [roleChangeConfirmed, setRoleChangeConfirmed] = useState(false);

  const roleChanged = selectedRoleId !== node.role_id;

  // Sign-in status (peeked — does NOT decrement reveal counter).
  const [status, setStatus] = useState<UserNodeCredentialStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // After a Reset password success, hold the newly-issued temp pwd inline
  // so the user can copy it without re-opening LoginManageModal.
  const [resetResult, setResetResult] = useState<null | { url: string; email: string; expiresAt: string }>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatusLoading(true);
      const r = await api.peekCredential(node.id);
      if (cancelled) return;
      setStatusLoading(false);
      if (r.ok) setStatus(r.data);
    })();
    return () => { cancelled = true; };
  }, [api, node.id]);

  const parentChanged = parentId !== (node.parent_id ?? null);
  const identityDirty =
    displayName.trim() !== node.display_name ||
    (email.trim() || null) !== (node.email ?? null) ||
    (phone.trim() || null) !== (node.phone ?? null) ||
    (notes.trim() || null) !== (node.notes ?? null) ||
    JSON.stringify(fields) !== JSON.stringify(node.fields ?? {});
  const dirty = identityDirty || parentChanged || (roleChanged && roleChangeConfirmed);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!displayName.trim()) { setError('Display name is required.'); return; }
    if (!dirty) { onClose(); return; }
    setSubmitting(true);

    if (identityDirty) {
      const r = await api.updateNode(node.id, {
        display_name: displayName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        fields,
      });
      if (!r.ok) {
        setSubmitting(false);
        setError(r.error.code === 'email_already_has_login_in_this_client'
          ? `Email is already taken by another user in this ${copy.scopeNoun}.`
          : `Failed (${r.error.code}).`);
        return;
      }
    }

    if (parentChanged) {
      const r = await api.moveNode(node.id, parentId, node.level_number);
      if (!r.ok) {
        setSubmitting(false);
        const code = r.error.code;
        const details = r.error.details as { max?: number } | undefined;
        const msg =
          code === 'cardinality_exceeded'
            ? `Per-parent limit reached at the target${details?.max !== undefined ? ` (max ${details.max})` : ''}.`
            : code === 'cycle_detected'
              ? 'That would create a cycle (you can’t move a user under their own descendant).'
              : code === 'parent_level_mismatch'
                ? 'The chosen parent is not at the level above this user.'
                : `Failed (${code}).`;
        setError(msg);
        return;
      }
    }

    if (roleChanged && roleChangeConfirmed) {
      const r = await api.changeRole(node.id, selectedRoleId);
      if (!r.ok) {
        setSubmitting(false);
        const code = r.error.code;
        const details = r.error.details as { max?: number } | undefined;
        const msg =
          code === 'cardinality_exceeded'
            ? `Limit reached for this role under the current parent${details?.max !== undefined ? ` (max ${details.max})` : ''}. Move the user first, or pick a different role.`
            : code === 'forbidden_role_change_scope'
              ? `Only admins and Owners can change roles.`
              : code === 'self_role_change_forbidden'
                ? `You can't change your own role.`
                : code === 'unassigned_node'
                  ? `Assign this user to a level first.`
                  : `Failed (${code}).`;
        setError(msg);
        return;
      }
    }

    setSubmitting(false);
    onSaved();
  }

  async function handleDelete() {
    const labelHint = role?.label ? ` (${role.label})` : '';
    if (!confirm(`Delete ${node.display_name}${labelHint}? This also removes their login if any.`)) return;
    setSubmitting(true);
    const r = await api.deleteNode(node.id);
    if (!r.ok && r.error.code === 'has_children') {
      setSubmitting(false);
      if (!confirm('This user has children in the tree. Delete them and all descendants?')) return;
      setSubmitting(true);
      const r2 = await api.deleteNode(node.id, true);
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
    setSubmitting(true);
    const r = await api.resetCredential(node.id);
    setSubmitting(false);
    setConfirmingReset(false);
    if (!r.ok) {
      setError(r.error.code === 'email_already_has_login_in_this_client'
        ? `Email is already taken by another login in this ${copy.scopeNoun}.`
        : `Failed (${r.error.code}).`);
      return;
    }
    setResetResult({
      url: r.data.set_password_url,
      email: status?.email ?? node.email ?? '',
      expiresAt: r.data.expires_at,
    });
    // Re-peek so the panel reflects the now-issued reset link and cleared reset request.
    const s = await api.peekCredential(node.id);
    if (s.ok) setStatus(s.data);
  }

  async function handleCopyPassword() {
    if (!resetResult) return;
    try {
      await navigator.clipboard.writeText(resetResult.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked (insecure context / permissions). Link is
      // still visible in the readonly input — caller can select-and-copy manually.
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

          {parentCandidates.length > 0 && (
            <label>Reports to (Level {node.level_number! - 1} parent)
              <select
                value={parentId ?? ''}
                onChange={(e) => setParentId(e.target.value || null)}
              >
                {parentCandidates.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name}</option>
                ))}
              </select>
            </label>
          )}

          {rolePickerVisible && (
            <label>Role
              <select
                value={selectedRoleId}
                disabled={rolePickerDisabled}
                title={rolePickerDisabled ? "You can't change your own role" : undefined}
                onChange={(e) => {
                  setSelectedRoleId(e.target.value);
                  setRoleChangeConfirmed(false);
                }}
              >
                {pickableRoles.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </label>
          )}

          {rolePickerVisible && roleChanged && !roleChangeConfirmed && (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 6,
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                fontSize: 12,
              }}
            >
              You're changing <strong>{node.display_name}</strong> from{' '}
              <strong>{role?.label ?? '(current)'}</strong> to{' '}
              <strong>{pickableRoles.find((r) => r.id === selectedRoleId)?.label ?? '(new)'}</strong>.
              This affects which views and bulk actions they appear in.
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setRoleChangeConfirmed(true)}
                  disabled={submitting}
                >
                  Confirm role change
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSelectedRoleId(node.role_id)}
                  disabled={submitting}
                >
                  Revert
                </button>
              </div>
            </div>
          )}

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
                      Issue a set-password link below and share it out-of-band.
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
                      Set-password link — share with {resetResult.email || 'the user'}. It expires {new Date(resetResult.expiresAt).toLocaleString()}.
                    </p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        readOnly
                        value={resetResult.url}
                        style={{ flex: 1 }}
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
                    <span>Issue a new set-password link?</span>
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
                    title={!status.email ? 'Add an email to the user first' : 'Issue a new set-password link'}
                  >
                    Issue reset link
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
