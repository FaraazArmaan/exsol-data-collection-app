import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listUserNodes, type UserNode } from '../api';

interface ClientDetail {
  id: string;
  name: string;
  slug: string;
}

interface ImpersonateResponse {
  slug: string;
  name: string;
  as_display_name: string;
  mode: 'admin_full_access' | 'user';
  impersonation_started_at: string;
}

export default function AdminClientEntry() {
  const { clientId } = useParams<{ clientId: string }>();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [nodes, setNodes] = useState<UserNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const [clientRes, nodesRes] = await Promise.all([
        fetch(`/api/clients-detail?id=${encodeURIComponent(clientId)}`, { credentials: 'same-origin' }),
        listUserNodes(clientId),
      ]);
      if (cancelled) return;
      if (!clientRes.ok) {
        setError('Failed to load client.');
        setLoading(false);
        return;
      }
      if (!nodesRes.ok) {
        setError(`Failed to load users (${nodesRes.error.code}).`);
        setLoading(false);
        return;
      }
      const body = await clientRes.json() as { client: ClientDetail };
      setClient(body.client);
      setNodes(nodesRes.data.nodes);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const sortedNodes = useMemo(
    () => [...nodes].filter((n) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [n.display_name, n.email, n.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    }).sort((a, b) => {
      const la = a.level_number ?? 999;
      const lb = b.level_number ?? 999;
      return la - lb || a.display_name.localeCompare(b.display_name);
    }),
    [nodes, query],
  );

  async function enter(userNode?: UserNode) {
    if (!clientId || !client) return;
    const key = userNode?.id ?? 'admin';
    setOpening(key);
    setError(null);
    const reason = userNode
      ? `Admin entered ${client.name} as ${userNode.display_name}`
      : `Admin entered ${client.name} with full access`;
    try {
      const r = await fetch('/api/admin-impersonate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, reason, ...(userNode ? { userNodeId: userNode.id } : {}) }),
      });
      if (!r.ok) {
        setError('Could not enter workspace.');
        setOpening(null);
        return;
      }
      const body = await r.json() as ImpersonateResponse;
      document.cookie = `imp_ctx=${encodeURIComponent(body.name)}; Path=/; SameSite=Lax; Max-Age=${24 * 60 * 60}`;
      document.cookie = `imp_actor=${encodeURIComponent(body.mode === 'admin_full_access' ? 'admin' : body.as_display_name)}; Path=/; SameSite=Lax; Max-Age=${24 * 60 * 60}`;
      document.cookie = `imp_started=${encodeURIComponent(body.impersonation_started_at)}; Path=/; SameSite=Lax; Max-Age=${24 * 60 * 60}`;
      window.location.href = `/c/${body.slug}`;
    } catch {
      setError('Could not enter workspace.');
      setOpening(null);
    }
  }

  if (!clientId) return <p className="error">Invalid URL.</p>;
  if (loading) return <p className="muted">Loading…</p>;
  if (!client) return <p className="error">{error ?? 'Client not found.'}</p>;

  const levelsCount = new Set(nodes.map((n) => n.level_number).filter((v) => v !== null)).size;

  return (
    <section className="admin-entry">
      <header className="admin-entry__header">
        <div>
          <p className="admin-entry__eyebrow">Workspace access</p>
          <h1 className="page-title">{client.name}</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>{client.slug}</p>
        </div>
        <div className="admin-entry__stats" aria-label="Workspace summary">
          <div><strong>{nodes.length}</strong><span>users</span></div>
          <div><strong>{levelsCount}</strong><span>levels</span></div>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="admin-entry__admin-panel">
        <div>
          <div className="admin-entry__row-title">Admin / Full access</div>
          <div className="admin-entry__row-sub">All modules and workspace settings</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={opening !== null}
          onClick={() => { void enter(); }}
        >
          {opening === 'admin' ? 'Opening…' : 'Enter as admin'}
        </button>
      </div>

      <div className="admin-entry__users-panel">
        <div className="admin-entry__users-head">
          <div>
            <h2>Impersonate user</h2>
            <p className="muted">{sortedNodes.length} available</p>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users"
            aria-label="Search users"
            className="admin-entry__search"
          />
        </div>
        {sortedNodes.length === 0 && <p className="muted">No users in this workspace.</p>}
        <div className="admin-entry__user-list">
          {sortedNodes.map((n) => (
            <button
              key={n.id}
              type="button"
              className="admin-entry__user-row"
              disabled={opening !== null}
              onClick={() => { void enter(n); }}
            >
              <span className="admin-entry__avatar" aria-hidden>{n.display_name.slice(0, 1).toUpperCase()}</span>
              <span className="admin-entry__identity">
                <span className="admin-entry__row-title">{n.display_name}</span>
                <span className="admin-entry__row-sub">{n.email ?? n.phone ?? 'No login credential'}</span>
              </span>
              <span className="admin-entry__level-chip">
                {n.level_number === null ? 'Unassigned' : `Level ${n.level_number}`}
              </span>
              <span className="admin-entry__arrow" aria-hidden>→</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
