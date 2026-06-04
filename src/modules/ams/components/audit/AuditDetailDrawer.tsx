import { useEffect } from 'react';
import type { AuditLogEntry } from '../../api';
import { actionLabel } from './op-labels';

interface Props {
  entry: AuditLogEntry | null;
  onClose: () => void;
}

export function AuditDetailDrawer({ entry, onClose }: Props) {
  useEffect(() => {
    if (!entry) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [entry, onClose]);

  if (!entry) return null;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 90,
      display: 'flex', justifyContent: 'flex-end',
    }}>
      <aside onClick={(e) => e.stopPropagation()} style={{
        width: 'min(520px, 90vw)', background: 'var(--bg-surface)', borderLeft: '1px solid var(--border-subtle)',
        padding: 20, overflowY: 'auto',
      }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Audit entry #{entry.id}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>×</button>
        </header>
        <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, fontSize: 13 }}>
          <dt className="muted">When</dt><dd>{new Date(entry.occurred_at).toLocaleString()}<br /><span className="muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>{entry.occurred_at}</span></dd>
          <dt className="muted">Actor</dt><dd><strong>{entry.actor.label}</strong><br /><span className="muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>{entry.actor.kind} · {entry.actor.id ?? '—'}</span></dd>
          <dt className="muted">Action</dt>
          <dd>
            {actionLabel(entry.op)}<br />
            <span className="muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>{entry.op}</span>
          </dd>
          <dt className="muted">Client</dt><dd>{entry.client_name ?? '—'}<br /><span className="muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>{entry.client_id ?? ''}</span></dd>
          <dt className="muted">Target</dt>
          <dd>
            {entry.target_label ?? '—'}
            {entry.target_type && entry.target_id ? (
              <>
                <br />
                <span className="muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>{entry.target_type}:{entry.target_id}</span>
              </>
            ) : null}
          </dd>
        </dl>
        <h3 style={{ marginTop: 20, marginBottom: 8, fontSize: 14 }}>Detail</h3>
        <pre style={{
          background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', padding: 12,
          borderRadius: 'var(--radius-sm)', fontSize: 12, maxHeight: '50vh', overflow: 'auto',
        }}>
          {entry.detail ? JSON.stringify(entry.detail, null, 2) : '(empty)'}
        </pre>
      </aside>
    </div>
  );
}
