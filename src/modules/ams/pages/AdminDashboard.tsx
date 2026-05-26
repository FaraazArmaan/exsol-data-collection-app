import { useEffect, useState } from 'react';
import { listClients, type ClientSummary } from '../api';
import { ClientCard } from '../components/ClientCard';
import { AddClientModal } from '../components/AddClientModal';

export default function AdminDashboard() {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    const r = await listClients();
    setLoading(false);
    if (!r.ok) {
      setError(`Failed to load: ${r.error.code}`);
      return;
    }
    setClients(r.data.clients);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Clients</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Client</button>
      </header>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && clients.length === 0 && (
        <p className="muted">No clients yet. Click "+ Add Client" to create one.</p>
      )}
      {!loading && !error && clients.length > 0 && (
        <div className="grid">
          {clients.map((c) => (
            <ClientCard key={c.id} client={c} onDeleted={refresh} />
          ))}
        </div>
      )}

      {showAdd && (
        <AddClientModal onClose={() => setShowAdd(false)} onCreated={refresh} />
      )}
    </section>
  );
}
