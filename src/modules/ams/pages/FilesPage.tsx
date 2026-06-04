// Admin "Files" page — raw monospace tree of every workspace's structure.
//
// Top-level list polls every 5s so newly-onboarded workspaces appear without
// a refresh. Each ClientFilesCard owns its own per-client poll while expanded.

import { useEffect, useState } from 'react';
import { listClients, type ClientSummary } from '../api';
import { ClientFilesCard } from '../components/files/ClientFilesCard';

const LIST_POLL_MS = 5000;

export default function FilesPage() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  async function refresh() {
    const r = await listClients();
    if (!r.ok) { setError(`Failed to load clients: ${r.error.code}`); return; }
    setError(null);
    setClients(r.data.clients);
    setLastFetched(Date.now());
  }

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
    const id = window.setInterval(() => { void refresh(); }, LIST_POLL_MS);
    return () => { window.clearInterval(id); };
  }, []);

  return (
    <section>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Files</h1>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
            Raw tree view · polls every 5s · click any node to expand
          </p>
        </div>
        <div className="muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
          {lastFetched && <>↻ {secondsAgo(lastFetched)}</>}
          <button className="btn btn-ghost" onClick={() => void refresh()}>Refresh now</button>
        </div>
      </header>

      <div style={{
        background: 'var(--bg-elevated, #1a1a1a)',
        border: '1px solid var(--border-subtle, #2a2a2a)',
        borderRadius: 6,
        padding: 12,
      }}>
        {loading && <p className="muted">Loading…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && clients.length === 0 && (
          <p className="muted">No workspaces yet.</p>
        )}
        {clients.map((c) => (
          <ClientFilesCard key={c.id} client={c} />
        ))}
      </div>
    </section>
  );
}

function secondsAgo(t: number): string {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}
