import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { createUserNode, type ClientRole, type ClientLevel, type UserNode } from '../api';
import { generateTempPassword } from '../../../lib/random-password';

interface Props {
  clientId: string;
  clientSlug: string;
  roles: ClientRole[];
  levels: ClientLevel[];
  nodes: UserNode[];
  presetLevel?: number | null;
  presetParent?: string | null;
  onClose: () => void;
  onCreated: () => void;
}

export function AddUserNodeModal({ clientId, clientSlug, roles, levels, nodes, presetLevel, presetParent, onClose, onCreated }: Props) {
  const [roleId, setRoleId] = useState<string>(roles[0]?.id ?? '');
  const role = roles.find((r) => r.id === roleId);
  const allowedLevels = useMemo(
    () => levels.filter((l) => l.allowed_role_ids.includes(roleId)),
    [levels, roleId],
  );
  // If admin defined levels but never toggled this role on any of them, the
  // strict filter returns []. That's almost always a misconfiguration rather
  // than intent — fall back to all levels so the admin can still place the
  // user, but render a warning that explains the setup gap.
  const noLevelMappedToRole = levels.length > 0 && allowedLevels.length === 0;
  const selectableLevels = noLevelMappedToRole ? levels : allowedLevels;
  const [levelNumber, setLevelNumber] = useState<number | null>(presetLevel ?? allowedLevels[0]?.level_number ?? null);
  const [parentId, setParentId] = useState<string | null>(presetParent ?? null);
  const [unassigned, setUnassigned] = useState(false);
  const validParents = useMemo(
    () => levelNumber === null ? [] : nodes.filter((n) => n.level_number === levelNumber - 1),
    [nodes, levelNumber],
  );

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [createLogin, setCreateLogin] = useState(false);
  const [tempPassword, setTempPassword] = useState(() => generateTempPassword());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [postCreate, setPostCreate] = useState<null | { tempPassword: string; email: string }>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!roleId) { setError('Pick a role.'); return; }
    if (createLogin && !email.trim()) { setError('Email required when creating a login.'); return; }
    if (createLogin && tempPassword.length < 8) { setError('Temp password must be ≥ 8 chars.'); return; }

    const body = {
      role_id: roleId,
      parent_id: unassigned ? null : parentId,
      level_number: unassigned ? null : (levelNumber ?? null),
      display_name: displayName.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      notes: notes.trim() || null,
      fields,
      create_login: createLogin,
      temp_password: createLogin ? tempPassword : undefined,
    };

    setSubmitting(true);
    const r = await createUserNode(clientId, body);
    setSubmitting(false);
    if (!r.ok) {
      const code = r.error.code;
      const details = r.error.details as { max?: number; role_id?: string } | undefined;
      let msg: string;
      if (code === 'cardinality_exceeded') {
        const maxLabel = details?.max !== undefined ? `max ${details.max}` : 'limit reached';
        const roleLabel = details?.role_id ? (roles.find((r) => r.id === details.role_id)?.label ?? '') : '';
        msg = `Per-parent limit reached${roleLabel ? ` (${maxLabel} ${roleLabel})` : ` (${maxLabel})`}.`;
      } else if (code === 'email_already_has_login_in_this_client') {
        msg = 'Email already has a login in this client.';
      } else if (code === 'parent_level_mismatch') {
        msg = 'Selected parent is at the wrong level.';
      } else {
        msg = `Failed (${code}).`;
      }
      setError(msg);
      return;
    }
    if (createLogin && r.data.login_created) {
      setPostCreate({ tempPassword, email });
      return;
    }
    onCreated();
  }

  if (postCreate) {
    const loginUrl = `${window.location.origin}/c/${clientSlug}/login`;
    return (
      <Modal title="Login created" onClose={onCreated}>
        <p className="muted">Share these with the user. You'll be able to re-view the password up to 3 times.</p>
        <Reveal label="Login URL" value={loginUrl} />
        <Reveal label="Email" value={postCreate.email} />
        <Reveal label="Temp password" value={postCreate.tempPassword} mono />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn btn-primary" onClick={onCreated}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <label>Role
          <select required value={roleId} onChange={(e) => { setRoleId(e.target.value); setLevelNumber(null); }}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <input type="checkbox" checked={unassigned} onChange={(e) => setUnassigned(e.target.checked)} />
          <span>Create as unassigned (no parent / no level)</span>
        </label>

        {!unassigned && (
          <>
            {levels.length === 0 && (
              <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                No levels exist yet. <Link to={`/clients/${clientId}/configure`}>Add a level first</Link>, or check "Create as unassigned" above.
              </p>
            )}
            {noLevelMappedToRole && (
              <p className="muted" style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--warning, #f59e0b)' }}>
                ⚠ {role?.label ?? 'This role'} isn't marked allowed at any level. You can still pick one,
                but you'll get a friendlier setup by toggling {role?.label ?? 'the role'} on at least one level under <Link to={`/clients/${clientId}/configure`}>Configure structure</Link>.
              </p>
            )}
            {selectableLevels.length > 0 && (
              <label>Level
                <select value={levelNumber ?? ''} onChange={(e) => { setLevelNumber(e.target.value ? Number(e.target.value) : null); setParentId(null); }}>
                  <option value="">— pick a level —</option>
                  {selectableLevels.map((l) => (
                    <option key={l.id} value={l.level_number}>
                      Level {l.level_number}{l.label ? ` (${l.label})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {levelNumber !== null && levelNumber > 1 && (
              <label>Parent
                <select required value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
                  <option value="">— pick a parent —</option>
                  {validParents.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
              </label>
            )}
          </>
        )}

        <hr style={{ margin: '12px 0' }} />

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
                onChange={(e) => setFields({ ...fields, [f.key]: f.type === 'integer' ? Number(e.target.value) : e.target.value })}
              />
            )}
          </label>
        ))}

        <fieldset style={{ border: '1px solid var(--border-subtle)', borderRadius: 6, padding: 10, marginTop: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} disabled={!email.trim()} />
            <span>Create login for this user</span>
          </label>
          {!email.trim() && <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>Fill in an email above to enable.</p>}
          {createLogin && (
            <label>Temp password
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  value={tempPassword}
                  minLength={8}
                  onChange={(e) => setTempPassword(e.target.value)}
                  style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                />
                <button type="button" className="btn btn-ghost" onClick={() => setTempPassword(generateTempPassword())}>Regen</button>
              </div>
            </label>
          )}
        </fieldset>

        {error && <p className="error">{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '…' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
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
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Reveal({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* */ }
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <code style={{ flex: 1, padding: '6px 8px', border: '1px solid var(--border-subtle)', borderRadius: 4, fontFamily: mono ? 'var(--font-mono)' : undefined, background: 'var(--bg-elevated, #1a1a1a)', wordBreak: 'break-all' }}>{value}</code>
        <button type="button" className="btn btn-ghost" onClick={copy}>{copied ? '✓' : 'copy'}</button>
      </div>
    </div>
  );
}
