// src/modules/ams/pages/AccessLevelDashboard.tsx
//
// Primary's view: a card per Level (≥ L2). L1 (Primary) is shown as a
// read-only "Full access" banner. Default labels Primary/Secondary/...
// are shown when the Client hasn't set a custom label.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ClientStructureProvider, useClientStructure } from '../components/ClientStructureContext';
import { getLevelPermissions, type LevelPermissionsResponse } from '../api';
import { PermissionMatrixCard } from '../components/PermissionMatrixCard';

const DEFAULT_LABELS = ['Primary', 'Secondary', 'Tertiary', 'Quaternary', 'Quinary', 'Senary', 'Septenary'];

export default function AccessLevelDashboard() {
  const { clientId } = useParams<{ clientId: string }>();
  if (!clientId) return <p className="error">Invalid URL.</p>;
  return (
    <ClientStructureProvider clientId={clientId}>
      <Inner clientId={clientId} />
    </ClientStructureProvider>
  );
}

function Inner({ clientId }: { clientId: string }) {
  const { structure, loading: structLoading } = useClientStructure();
  const [perLevel, setPerLevel] = useState<Record<string, LevelPermissionsResponse>>({});
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!structure) return;
    setLoading(true);
    const out: Record<string, LevelPermissionsResponse> = {};
    for (const lvl of structure.levels) {
      const r = await getLevelPermissions(lvl.id);
      if (r.ok) out[lvl.id] = r.data;
    }
    setPerLevel(out);
    setLoading(false);
  }

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [structure]);

  if (structLoading || loading) return <p className="muted">Loading…</p>;
  if (!structure) return null;

  return (
    <section>
      <header style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Access Level Dashboard</h1>
        <Link to={`/clients/${clientId}`} className="btn btn-secondary">← Back</Link>
      </header>
      <p className="muted" style={{ marginBottom: 16 }}>
        Configure what each Level can do. Primary (Level 1) always has full access.
      </p>

      {structure.levels.map((lvl) => {
        const label = lvl.label ?? DEFAULT_LABELS[lvl.level_number - 1] ?? `Level ${lvl.level_number}`;
        if (lvl.level_number === 1) {
          return (
            <div key={lvl.id} className="card" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>{label} <span className="muted" style={{ fontSize: 12 }}>Level 1 — Full access</span></h3>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                The Primary level always has every permission. To delegate, configure the levels below.
              </p>
            </div>
          );
        }
        const data = perLevel[lvl.id];
        if (!data) return null;
        return (
          <PermissionMatrixCard
            key={lvl.id}
            data={data}
            levelLabel={label}
            onSaved={refresh}
          />
        );
      })}
    </section>
  );
}
