import { useEffect, useState } from 'react';
import { emailApi } from './shared/api';
import type { OutboxRow } from './shared/types';

const TEMPLATE_LABEL: Record<string, string> = {
  booking_confirmation: 'Booking confirmation',
  storefront_receipt: 'Storefront receipt',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

// slug/perms are passed by the route gate; the outbox is client-scoped server-side.
export default function EmailOutboxPage(_props: { slug: string; perms: ReadonlySet<string> }) {
  const [rows, setRows] = useState<OutboxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OutboxRow | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    setRows(null);
    emailApi.listOutbox()
      .then((r) => { if (alive) setRows(r.emails); })
      .catch((e) => { if (alive) setError(e?.code ?? 'load_failed'); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="em-page">
      <header className="em-head">
        <h1>Email &amp; Notifications</h1>
        <p className="em-sub">
          Every transactional email your workspace has sent — booking confirmations and order receipts.
        </p>
      </header>

      {error && (
        <div className="em-state em-state-error" role="alert">
          Couldn't load the outbox ({error}).{' '}
          <button className="btn btn-ghost" onClick={() => location.reload()}>Retry</button>
        </div>
      )}

      {!error && rows === null && <div className="em-state">Loading outbox…</div>}

      {!error && rows !== null && rows.length === 0 && (
        <div className="em-state em-empty">
          <strong>No emails yet.</strong>
          <span>When a customer books or checks out, the confirmation lands here.</span>
        </div>
      )}

      {!error && rows !== null && rows.length > 0 && (
        <table className="em-table">
          <thead>
            <tr>
              <th>Recipient</th><th>Type</th><th>Subject</th><th>Status</th><th>Sent</th><th aria-label="Preview" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.to_email}</td>
                <td>{TEMPLATE_LABEL[r.template] ?? r.template}</td>
                <td className="em-subject">{r.subject}</td>
                <td><span className={`em-badge em-badge-${r.status}`}>{r.status}</span></td>
                <td>{fmt(r.sent_at ?? r.created_at)}</td>
                <td><button className="btn btn-ghost" onClick={() => setPreview(r)}>Preview</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {preview && (
        <div className="em-drawer-scrim" onClick={() => setPreview(null)}>
          <aside className="em-drawer" onClick={(e) => e.stopPropagation()}>
            <header className="em-drawer-head">
              <div>
                <div className="em-drawer-subject">{preview.subject}</div>
                <div className="em-drawer-meta">
                  To {preview.to_email} · {preview.status}
                  {preview.error ? ` · ${preview.error}` : ''}
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setPreview(null)} aria-label="Close preview">✕</button>
            </header>
            {/* Fully sandboxed (no scripts) — stored HTML can't execute in the admin origin. */}
            <iframe className="em-drawer-frame" title="Email preview" sandbox="" srcDoc={preview.body_html} />
          </aside>
        </div>
      )}
    </div>
  );
}
