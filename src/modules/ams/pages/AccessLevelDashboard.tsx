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
    const results = await Promise.all(
      structure.levels.map((lvl) => getLevelPermissions(lvl.id)),
    );
    const out: Record<string, LevelPermissionsResponse> = {};
    results.forEach((r, i) => {
      if (r.ok) out[structure.levels[i]!.id] = r.data;
    });
    setPerLevel(out);
    setLoading(false);
  }

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [structure]);

  if (structLoading || loading) return <p className="muted">Loading…</p>;
  if (!structure) return null;

  return (
    <section className="page">
      <header className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Access Level Dashboard</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Configure what each Level can do. Primary (Level 1) always has full access.
          </p>
        </div>
        <Link to={`/clients/${clientId}`} className="btn btn-secondary">← Back</Link>
      </header>

      {structure.levels.map((lvl) => {
        const label = lvl.label ?? DEFAULT_LABELS[lvl.level_number - 1] ?? `Level ${lvl.level_number}`;
        if (lvl.level_number === 1) {
          return (
            <div key={lvl.id} className="card" style={{ marginBottom: 16 }}>
              <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>{label}</h3>
                <span className="perm-level-chip">Level 1 — Full access</span>
              </header>
              <p className="muted" style={{ margin: 0 }}>
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
