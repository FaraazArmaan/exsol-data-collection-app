// Paste-CSV → preview-table → bulk submit. Shared by AccessDashboard (admin)
// and UserManageTeam (owner) via TeamMemberApi injection.

import { useMemo, useState, type ReactNode } from 'react';
import type { ClientRole, ClientLevel } from '../../ams/api';
import type { TeamMemberApi } from './types';
import { parseCsv, type ParsedRow, type ParseError } from './csv-parser';

interface Props {
  api: TeamMemberApi;
  roles: ClientRole[];
  levels: ClientLevel[];
  onClose: () => void;
  onCreated: (summary: { created: number; logins: number }) => void;
}

interface ServerRowError { row_index: number; errors: string[] }

const TEMPLATE = [
  'display_name,role_key,level_number,parent_email,email,phone,notes,create_login,temp_password',
  'Alice,owner,1,,alice@example.com,,,true,abc12345',
  'Bob,manager,2,alice@example.com,bob@example.com,,,false,',
].join('\n');

export function BulkInviteModal({ api, roles, levels, onClose, onCreated }: Props) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
  const [serverErrors, setServerErrors] = useState<ServerRowError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const roleKeys = useMemo(() => new Set(roles.map((r) => r.key)), [roles]);
  const levelNumbers = useMemo(() => new Set(levels.map((l) => l.level_number)), [levels]);

  function clientSideRowErrors(r: ParsedRow): string[] {
    const errs: string[] = [];
    if (!r.display_name.trim()) errs.push('missing display_name');
    if (!r.role_key.trim()) errs.push('missing role_key');
    else if (!roleKeys.has(r.role_key)) errs.push(`unknown role_key "${r.role_key}"`);
    if (r.level_number !== null && !levelNumbers.has(r.level_number)) {
      errs.push(`unknown level_number ${r.level_number}`);
    }
    if (r.create_login && (!r.email)) errs.push('create_login=true requires email');
    if (r.create_login && r.temp_password.length < 8) errs.push('create_login=true requires temp_password (≥8)');
    return errs;
  }

  function handleParse() {
    setTopError(null);
    setServerErrors([]);
    const result = parseCsv(text);
    setRows(result.rows);
    setParseErrors(result.parseErrors);
  }

  function updateRow(idx: number, patch: Partial<ParsedRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function deleteRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function addRow() {
    setRows((prev) => [...prev, {
      display_name: '', role_key: roles[0]?.key ?? '', level_number: null,
      parent_email: null, email: null, phone: null, notes: null,
      create_login: false, temp_password: '',
    }]);
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'bulk-invite-template.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleSubmit() {
    setTopError(null);
    setServerErrors([]);
    if (rows.length === 0) { setTopError('No rows to submit.'); return; }
    if (rows.length > 500) { setTopError(`Too many rows (${rows.length}/500).`); return; }
    // Client-side fast-fail.
    const failing = rows.flatMap((r, i) => {
      const errs = clientSideRowErrors(r);
      return errs.length === 0 ? [] : [{ row_index: i, errors: errs }];
    });
    if (failing.length > 0) { setServerErrors(failing); setTopError('Fix the highlighted rows.'); return; }

    setSubmitting(true);
    const payload = rows.map((r) => ({
      display_name: r.display_name.trim(),
      role_key: r.role_key,
      level_number: r.level_number,
      parent_email: r.parent_email,
      email: r.email,
      phone: r.phone,
      notes: r.notes,
      create_login: r.create_login,
      temp_password: r.create_login ? r.temp_password : undefined,
    }));
    const r = await api.bulkInvite(payload);
    setSubmitting(false);
    if (!r.ok) {
      const details = r.error.details as { errors?: ServerRowError[] } | undefined;
      if (r.error.code === 'bulk_validation_failed' && details?.errors) {
        setServerErrors(details.errors);
        setTopError('Server rejected some rows — see highlights.');
        return;
      }
      setTopError(`Failed (${r.error.code}).`);
      return;
    }
    onCreated({ created: r.data.nodes.length, logins: r.data.login_count });
  }

  const errorsByRow = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const e of serverErrors) m.set(e.row_index, e.errors);
    return m;
  }, [serverErrors]);

  return (
    <Modal title="Bulk invite" onClose={onClose}>
      {rows.length === 0 ? (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Paste a CSV with a header row. Required columns: <code>display_name</code>, <code>role_key</code>.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={TEMPLATE}
            style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
          />
          {parseErrors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {parseErrors.map((e, i) => <p key={i} className="error" style={{ margin: '2px 0' }}>Row {e.row}: {e.message}</p>)}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={downloadTemplate}>Download template</button>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleParse}>Parse</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
            {rows.length} row{rows.length === 1 ? '' : 's'} parsed. Inline-edit, delete (×), or add rows below.
          </p>
          <div style={{ overflowX: 'auto', maxHeight: '50vh', overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['', '#', 'display_name', 'role_key', 'level', 'parent_email', 'email', 'create_login', 'temp_password'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--border-subtle)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const errs = errorsByRow.get(i);
                  const rowStyle = errs ? { background: 'rgba(239, 68, 68, 0.08)' } : undefined;
                  return (
                    <tr key={i} style={rowStyle}>
                      <td style={{ padding: '2px 4px' }}>
                        <button type="button" className="btn btn-ghost" onClick={() => deleteRow(i)} title="Delete row">×</button>
                      </td>
                      <td style={{ padding: '2px 4px' }}>{i + 1}</td>
                      <td><input value={r.display_name} onChange={(e) => updateRow(i, { display_name: e.target.value })} /></td>
                      <td>
                        <select value={r.role_key} onChange={(e) => updateRow(i, { role_key: e.target.value })}>
                          <option value="">—</option>
                          {roles.map((rl) => <option key={rl.id} value={rl.key}>{rl.label}</option>)}
                        </select>
                      </td>
                      <td><input type="number" value={r.level_number ?? ''}
                        onChange={(e) => updateRow(i, { level_number: e.target.value === '' ? null : Number(e.target.value) })}
                        style={{ width: 60 }} /></td>
                      <td><input value={r.parent_email ?? ''} onChange={(e) => updateRow(i, { parent_email: e.target.value || null })} /></td>
                      <td><input value={r.email ?? ''} onChange={(e) => updateRow(i, { email: e.target.value || null })} /></td>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={r.create_login} onChange={(e) => updateRow(i, { create_login: e.target.checked })} />
                      </td>
                      <td><input value={r.temp_password} onChange={(e) => updateRow(i, { temp_password: e.target.value })}
                        style={{ fontFamily: 'var(--font-mono)' }} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {serverErrors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {serverErrors.map((e, i) => (
                <p key={i} className="error" style={{ margin: '2px 0', fontSize: 12 }}>
                  Row {e.row_index + 1}: {e.errors.join('; ')}
                </p>
              ))}
            </div>
          )}
          {topError && <p className="error">{topError}</p>}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={addRow}>+ Add row</button>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setRows([]); setText(''); setServerErrors([]); }} disabled={submitting}>
                Back to paste
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? '…' : `Create ${rows.length} user${rows.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 'min(960px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
