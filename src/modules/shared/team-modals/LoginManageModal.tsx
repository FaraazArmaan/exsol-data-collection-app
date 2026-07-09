// Shared Login-management modal. See ./types.ts for the api/copy contract.

import { useEffect, useState, type FormEvent } from 'react';
import type { UserNode } from '../../ams/api';
import type { UserNodeCredentialStatus } from '../../ams/api';
import type { TeamMemberApi, TeamMemberCopy } from './types';

interface Props {
  api: TeamMemberApi;
  copy: TeamMemberCopy;
  node: UserNode;
  clientSlug: string;
  onClose: () => void;
  onChanged: () => void;
}

export function LoginManageModal({ api, copy, node, clientSlug, onClose, onChanged }: Props) {
  const [status, setStatus] = useState<UserNodeCredentialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [issuedLink, setIssuedLink] = useState<{ url: string; expiresAt: string } | null>(null);

  async function load() {
    setLoading(true); setError(null);
    const r = await api.getCredential(node.id);
    setLoading(false);
    if (!r.ok) { setError(`Failed (${r.error.code})`); return; }
    setStatus(r.data);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const loginUrl = `${window.location.origin}/c/${clientSlug}/login`;
  const hasEmail = !!node.email;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!hasEmail) { setError('Add an email to the user first.'); return; }
    setSubmitting(true);
    const r = await api.resetCredential(node.id);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.code === 'email_already_has_login_in_this_client'
        ? `This email already has a login in this ${copy.scopeNoun}.`
        : `Failed (${r.error.code})`);
      return;
    }
    setIssuedLink({ url: r.data.set_password_url, expiresAt: r.data.expires_at });
    onChanged();
    await load();
  }

  async function handleRemove() {
    if (!confirm('Remove login? User row stays; credential is deleted.')) return;
    setSubmitting(true);
    const r = await api.deleteCredential(node.id);
    setSubmitting(false);
    if (!r.ok) { setError(`Failed (${r.error.code})`); return; }
    onChanged();
    setIssuedLink(null);
    await load();
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(480px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Login — {node.display_name}</h2>

        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error">{error}</p>}

        {!loading && status && (
          <>
            {status.has_credential ? (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  {status.last_login_at ? `Last login ${new Date(status.last_login_at).toLocaleString()}` : 'Never signed in yet.'}
                  {status.must_change_password && ' Must change pwd on next login.'}
                </p>
                <Reveal label="Login URL" value={loginUrl} />
                <Reveal label="Email" value={status.email ?? node.email ?? ''} />
                {issuedLink ? (
                  <>
                    <Reveal label="Set-password link" value={issuedLink.url} />
                    <p className="muted" style={{ fontSize: 11 }}>Expires {new Date(issuedLink.expiresAt).toLocaleString()}.</p>
                  </>
                ) : status.temp_password_plain ? (
                  <>
                    <Reveal label="Legacy temp password" value={status.temp_password_plain} mono />
                    <p className="muted" style={{ fontSize: 11 }}>Legacy views remaining: {status.temp_password_views_left}.</p>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>No active password link is currently visible.</p>
                )}
                <form onSubmit={handleSave} style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <button type="button" className="btn btn-ghost" onClick={handleRemove} disabled={submitting}>Remove login</button>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? '…' : 'Issue set-password link'}</button>
                  </div>
                </form>
              </>
            ) : (
              <form onSubmit={handleSave}>
                <p className="muted" style={{ marginTop: 0 }}>
                  {hasEmail ? 'No login yet. Issue a set-password link to create one.' : 'Add an email to the user first.'}
                </p>
                <Reveal label="Login URL" value={loginUrl} />
                <Reveal label="Email" value={node.email ?? '—'} />
                {issuedLink && (
                  <>
                    <Reveal label="Set-password link" value={issuedLink.url} />
                    <p className="muted" style={{ fontSize: 11 }}>Expires {new Date(issuedLink.expiresAt).toLocaleString()}.</p>
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={submitting || !hasEmail}>{submitting ? '…' : 'Issue set-password link'}</button>
                </div>
              </form>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
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
