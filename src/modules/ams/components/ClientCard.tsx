import { useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteClient, type ClientSummary } from '../api';

interface Props {
  client: ClientSummary;
  onDeleted: () => void;
}

export function ClientCard({ client, onDeleted }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm(`Delete client "${client.name}"? This drops ALL its users, roles, and login credentials permanently.`)) return;
    setBusy(true);
    const r = await deleteClient(client.id);
    setBusy(false);
    if (!r.ok) { alert(`Delete failed: ${r.error.code}`); return; }
    onDeleted();
  }

  return (
    <article className="card">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{client.name}</h3>
        <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{client.slug}</span>
      </header>
      <div style={{ display: 'flex', gap: 8 }}>
        <Link to={`/clients/${client.id}`} className="btn btn-secondary">enter →</Link>
        <button className="btn btn-danger" onClick={handleDelete} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </article>
  );
}
