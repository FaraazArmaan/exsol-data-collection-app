// src/modules/ams/components/onboarding/OnboardClientImportPreview.tsx
//
// 3-tab editable preview of a parsed XLSX template. On submit, posts
// to /api/onboard-client-bulk. On bulk_validation_failed, highlights
// the failing rows per-section.

import { useMemo, useState, type ReactNode } from 'react';
import { useAdminSessionHeartbeat } from '../../../../lib/use-admin-session-heartbeat';
import { onboardClientBulk } from '../../api';
import type {
  ParsedTemplate, ParsedRole, ParsedTeamMember, BulkRowError, OnboardClientBulkSuccess,
} from '../../../shared/onboarding-import/types';

interface Props {
  initial: ParsedTemplate;
  parseWarnings: { section: string; row?: number; message: string }[];
  onCancel: () => void;
  onCreated: (result: OnboardClientBulkSuccess) => void;
}

type Tab = 'workspace' | 'roles' | 'team';

export function OnboardClientImportPreview({ initial, parseWarnings, onCancel, onCreated }: Props) {
  useAdminSessionHeartbeat();
  const [tab, setTab] = useState<Tab>('workspace');
  const [template, setTemplate] = useState<ParsedTemplate>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<BulkRowError[]>([]);
  const [topError, setTopError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const errorsByRow = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of serverErrors) m.set(`${e.section}:${e.row_index}`, e.errors);
    return m;
  }, [serverErrors]);

  function patchWorkspace(patch: Partial<ParsedTemplate['workspace']>) {
    setTemplate((t) => ({ ...t, workspace: { ...t.workspace, ...patch } }));
  }
  function patchRole(idx: number, patch: Partial<ParsedRole>) {
    setTemplate((t) => ({ ...t, roles: t.roles.map((r, i) => i === idx ? { ...r, ...patch } : r) }));
  }
  function deleteRole(idx: number) {
    setTemplate((t) => ({ ...t, roles: t.roles.filter((_, i) => i !== idx) }));
  }
  function addRole() {
    setTemplate((t) => ({ ...t, roles: [...t.roles, { label: '', max_per_parent: null }] }));
  }
  function patchMember(idx: number, patch: Partial<ParsedTeamMember>) {
    setTemplate((t) => ({ ...t, team: t.team.map((m, i) => i === idx ? { ...m, ...patch } : m) }));
  }
  function deleteMember(idx: number) {
    setTemplate((t) => ({ ...t, team: t.team.filter((_, i) => i !== idx) }));
  }
  function addMember() {
    setTemplate((t) => ({
      ...t,
      team: [...t.team, {
        display_name: '', role_label: t.roles[0]?.label ?? '', parent_email: null,
        email: '', phone: null, notes: null, temp_password: null,
      }],
    }));
  }

  async function handleSubmit() {
    setTopError(null);
    setServerErrors([]);
    setSubmitting(true);
    const r = await onboardClientBulk(template);
    setSubmitting(false);
    if (!r.ok) {
      if (r.error.code === 'unauthorized') { setSessionExpired(true); return; }
      const details = r.error.details as { errors?: BulkRowError[]; key?: string; rows?: number[] } | undefined;
      if (r.error.code === 'bulk_validation_failed' && details?.errors) {
        setServerErrors(details.errors);
        setTopError('Server rejected some rows — see highlights.');
        return;
      }
      setTopError(`Failed (${r.error.code}).`);
      return;
    }
    onCreated(r.data);
  }

  if (sessionExpired) {
    return (
      <Shell title="Onboard from template — session expired" onCancel={onCancel}>
        <p style={{ marginTop: 0 }}>Your session expired. Refresh the page to sign in again.</p>
        <button type="button" className="btn btn-primary" onClick={() => { window.location.reload(); }}>
          Refresh
        </button>
      </Shell>
    );
  }

  return (
    <Shell title="Onboard from template" onCancel={onCancel}>
      <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['workspace', 'roles', 'team'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {tab !== t && hasErrorsInSection(serverErrors, t) && <span style={{ color: 'var(--danger, #ef4444)', marginLeft: 4 }}>•</span>}
          </button>
        ))}
      </div>

      {parseWarnings.length > 0 && (
        <div style={{ background: 'rgba(245, 158, 11, 0.08)', padding: 8, borderRadius: 4, marginBottom: 10 }}>
          {parseWarnings.map((w, i) => (
            <p key={i} className="muted" style={{ margin: 0, fontSize: 12 }}>⚠ {w.section}: {w.message}</p>
          ))}
        </div>
      )}

      {tab === 'workspace' && (
        <div>
          <label>Workspace name *
            <input value={template.workspace.name} onChange={(e) => patchWorkspace({ name: e.target.value })} />
          </label>
          <label>Enabled products (comma-separated keys)
            <input
              value={template.workspace.enabled_products.join(', ')}
              onChange={(e) => patchWorkspace({
                enabled_products: e.target.value.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
              })}
            />
          </label>
        </div>
      )}

      {tab === 'roles' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['', '#', 'Role', 'Max per parent'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--border-subtle)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {template.roles.map((r, i) => {
                const errs = errorsByRow.get(`roles:${i}`);
                return (
                  <tr key={i} style={errs ? { background: 'rgba(239, 68, 68, 0.08)' } : undefined}>
                    <td><button type="button" className="btn btn-ghost" onClick={() => deleteRole(i)} title="Delete role">×</button></td>
                    <td>{i + 1}</td>
                    <td><input value={r.label} onChange={(e) => patchRole(i, { label: e.target.value })} /></td>
                    <td>
                      <input
                        type="number" min={1}
                        value={r.max_per_parent ?? ''}
                        onChange={(e) => patchRole(i, { max_per_parent: e.target.value === '' ? null : Number(e.target.value) })}
                        style={{ width: 80 }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" className="btn btn-ghost" onClick={addRole}>+ Add role</button>
        </div>
      )}

      {tab === 'team' && (
        <div style={{ overflowX: 'auto', maxHeight: '50vh', overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['', '#', 'Display name', 'Role', 'Parent email', 'Email', 'Temp password'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--border-subtle)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {template.team.map((m, i) => {
                const errs = errorsByRow.get(`team:${i}`);
                return (
                  <tr key={i} style={errs ? { background: 'rgba(239, 68, 68, 0.08)' } : undefined}>
                    <td><button type="button" className="btn btn-ghost" onClick={() => deleteMember(i)} title="Delete row">×</button></td>
                    <td>{i + 1}</td>
                    <td><input value={m.display_name} onChange={(e) => patchMember(i, { display_name: e.target.value })} /></td>
                    <td>
                      <select value={m.role_label} onChange={(e) => patchMember(i, { role_label: e.target.value })}>
                        <option value="">—</option>
                        {template.roles.map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
                      </select>
                    </td>
                    <td><input value={m.parent_email ?? ''} onChange={(e) => patchMember(i, { parent_email: e.target.value || null })} /></td>
                    <td><input value={m.email} onChange={(e) => patchMember(i, { email: e.target.value })} /></td>
                    <td><input
                      placeholder="(auto)"
                      value={m.temp_password ?? ''}
                      onChange={(e) => patchMember(i, { temp_password: e.target.value || null })}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" className="btn btn-ghost" onClick={addMember}>+ Add team member</button>
        </div>
      )}

      {serverErrors.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {serverErrors.map((e, i) => (
            <p key={i} className="error" style={{ margin: '2px 0', fontSize: 12 }}>
              {e.section} row {e.row_index + 1}: {e.errors.join('; ')}
            </p>
          ))}
        </div>
      )}
      {topError && <p className="error">{topError}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '…' : `Create workspace (${template.team.length} member${template.team.length === 1 ? '' : 's'})`}
        </button>
      </div>
    </Shell>
  );
}

function hasErrorsInSection(errs: BulkRowError[], section: Tab): boolean {
  return errs.some((e) => e.section === section);
}

function Shell({ title, children, onCancel }: { title: string; children: ReactNode; onCancel: () => void }) {
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(1040px, 96vw)', maxHeight: '92vh', overflow: 'auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button type="button" className="btn btn-ghost" onClick={onCancel} aria-label="Cancel">×</button>
        </header>
        {children}
      </div>
    </div>
  );
}
