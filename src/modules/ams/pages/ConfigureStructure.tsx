import { Link, useParams } from 'react-router-dom';
import { ClientStructureProvider, useClientStructure } from '../components/ClientStructureContext';
import { RoleEditor } from '../components/RoleEditor';
import { LevelEditor } from '../components/LevelEditor';
import { CardinalityEditor } from '../components/CardinalityEditor';

interface Props {
  clientId?: string;
  backTo?: string;
}

export default function ConfigureStructure({ clientId: clientIdProp, backTo }: Props = {}) {
  const { clientId: routeClientId } = useParams<{ clientId: string }>();
  const clientId = clientIdProp ?? routeClientId;
  if (!clientId) return <p className="error">Invalid URL.</p>;
  return (
    <ClientStructureProvider clientId={clientId}>
      <ConfigureInner clientId={clientId} backTo={backTo} />
    </ClientStructureProvider>
  );
}

function ConfigureInner({ clientId, backTo }: { clientId: string; backTo?: string }) {
  const { structure, loading, error, refresh } = useClientStructure();

  return (
    <section>
      <header style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0 }}>Configure structure</h1>
          <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>Define roles, levels, and per-parent limits.</p>
        </div>
        <Link to={backTo ?? `/clients/${clientId}`} className="btn btn-secondary">← Back</Link>
      </header>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      {structure && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <RoleEditor clientId={clientId} roles={structure.roles} onChange={refresh} />
          </div>
          <div className="card" style={{ marginBottom: 16 }}>
            <LevelEditor clientId={clientId} levels={structure.levels} onChange={refresh} />
          </div>
          <div className="card">
            <CardinalityEditor clientId={clientId} rules={structure.cardinality_rules} roles={structure.roles} onChange={refresh} />
          </div>
        </>
      )}
    </section>
  );
}
