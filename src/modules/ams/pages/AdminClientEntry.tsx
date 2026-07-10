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
}

export default function AdminClientEntry() {
  const { clientId } = useParams<{ clientId: string }>();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [nodes, setNodes] = useState<UserNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

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
    () => [...nodes].sort((a, b) => {
      const la = a.level_number ?? 999;
      const lb = b.level_number ?? 999;
      return la - lb || a.display_name.localeCompare(b.display_name);
    }),
    [nodes],
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
      window.location.href = `/c/${body.slug}`;
    } catch {
      setError('Could not enter workspace.');
      setOpening(null);
    }
  }

  if (!clientId) return <p className="error">Invalid URL.</p>;
  if (loading) return <p className="muted">Loading…</p>;
  if (!client) return <p className="error">{error ?? 'Client not found.'}</p>;

  return (
    <section className="page" style={{ maxWidth: 900 }}>
      <header className="page-header" style={{ marginBottom: 18 }}>
        <h1 className="page-title" style={{ margin: 0 }}>{client.name}</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>Choose how to enter this workspace.</p>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 6px' }}>Admin / Full access</h3>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Open the normal client dashboard with full workspace privileges.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={opening !== null}
          onClick={() => { void enter(); }}
        >
          {opening === 'admin' ? 'Opening…' : 'Enter as admin'}
        </button>
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 12px' }}>Impersonate user</h3>
        {sortedNodes.length === 0 && <p className="muted">No users in this workspace.</p>}
        <div style={{ display: 'grid', gap: 8 }}>
          {sortedNodes.map((n) => (
            <button
              key={n.id}
              type="button"
              className="btn btn-secondary"
              disabled={opening !== null}
              onClick={() => { void enter(n); }}
              style={{ justifyContent: 'space-between' }}
            >
              <span>{n.display_name}</span>
              <span className="muted">
                {n.level_number === null ? 'Unassigned' : `Level ${n.level_number}`}
                {n.email ? ` · ${n.email}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
