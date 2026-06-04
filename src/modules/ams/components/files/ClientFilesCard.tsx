// One expandable card per client on the Files page. Self-contained polling:
// when expanded, refetches nodes + roles every 5s so the user can watch the
// tree update live as they import / create users.

import { useEffect, useMemo, useState } from 'react';
import {
  getClientStructure, listUserNodes, type ClientSummary, type ClientRole, type UserNode,
} from '../../api';
import { BucketSection, type BucketKey } from './BucketSection';

const POLL_MS = 5000;
const BUCKETS: BucketKey[] = ['business', 'employees', 'customers', 'products', 'other'];

interface Props {
  client: ClientSummary;
}

export function ClientFilesCard({ client }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [nodes, setNodes] = useState<UserNode[]>([]);
  const [roles, setRoles] = useState<ClientRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  async function fetchOnce() {
    setError(null);
    const [structRes, nodesRes] = await Promise.all([
      getClientStructure(client.id),
      listUserNodes(client.id),
    ]);
    if (!structRes.ok) { setError(`structure: ${structRes.error.code}`); return; }
    if (!nodesRes.ok) { setError(`nodes: ${nodesRes.error.code}`); return; }
    setRoles(structRes.data.roles);
    setNodes(nodesRes.data.nodes);
    setLastFetched(Date.now());
  }

  useEffect(() => {
    if (!expanded) return;
    setLoading(true);
    void fetchOnce().finally(() => setLoading(false));
    const id = window.setInterval(() => { void fetchOnce(); }, POLL_MS);
    return () => { window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, client.id]);

  const rolesById = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.id, r])) as Record<string, ClientRole>,
    [roles],
  );

  return (
    <div className="card" style={{ padding: 12, marginBottom: 10 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v); } }}
      >
        <span style={{ width: 16, display: 'inline-block', textAlign: 'center' }}>
          {expanded ? '▾' : '▸'}
        </span>
        <strong>{client.name}</strong>
        <code className="muted" style={{ fontSize: 11 }}>{client.slug}</code>
        {expanded && (
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
            {nodes.length} user{nodes.length === 1 ? '' : 's'}
            {lastFetched && ` · ↻ ${secondsAgo(lastFetched)}`}
          </span>
        )}
      </div>
      {expanded && (
        <div style={{ marginTop: 10 }}>
          {loading && nodes.length === 0 && <p className="muted" style={{ fontSize: 12 }}>Loading…</p>}
          {error && <p className="error" style={{ fontSize: 12 }}>{error}</p>}
          {!error && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 10,
            }}>
              {BUCKETS.map((b) => (
                <BucketSection key={b} bucket={b} nodes={nodes} rolesById={rolesById} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function secondsAgo(t: number): string {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}
