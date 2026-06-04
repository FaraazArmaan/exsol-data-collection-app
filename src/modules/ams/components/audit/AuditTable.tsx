import type { AuditLogEntry } from '../../api';
import { actionLabel, summarize } from './op-labels';

interface Props {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  error?: string | null;
  onRowClick: (entry: AuditLogEntry) => void;
  onPageChange: (page: number) => void;
}

export function AuditTable({ entries, total, page, pageSize, loading, error, onRowClick, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="error">{error}</p>;
  if (entries.length === 0) return <p className="muted">No audit entries match the current filter.</p>;

  return (
    <>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>When</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Actor</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Action</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Summary</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Workspace</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>Target</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const summary = summarize(e.op, e.detail);
              return (
                <tr key={e.id} onClick={() => onRowClick(e)}
                  style={{ cursor: 'pointer', borderTop: '1px solid var(--border-subtle)' }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.background = 'var(--bg-elevated)')}
                  onMouseLeave={(ev) => (ev.currentTarget.style.background = '')}>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>
                    {new Date(e.occurred_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.actor.kind}</span>{' '}
                    <strong>{e.actor.label}</strong>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{actionLabel(e.op)}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                    {summary || ''}
                  </td>
                  <td style={{ padding: '8px 12px' }}>{e.client_name ?? <span className="muted">—</span>}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {e.target_label
                      ? e.target_label
                      : <span className="muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, fontSize: 13 }}>
        <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>← Prev</button>
        <span>Page {page} of {totalPages} ({total} entries)</span>
        <button type="button" className="btn btn-ghost" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next →</button>
      </div>
    </>
  );
}
