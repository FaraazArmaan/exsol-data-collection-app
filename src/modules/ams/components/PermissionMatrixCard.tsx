// src/modules/ams/components/PermissionMatrixCard.tsx
//
// One Level's permission card: Modules grid (auto-generated from the
// active Products' Modules × their DataBuckets) plus a fixed Platform
// grid. Save replaces the entire JSONB matrix server-side.

import { useState } from 'react';
import {
  putLevelPermissions,
  type LevelPermissionsResponse, type ModuleRow, type PlatformRow,
} from '../api';

interface Props {
  data: LevelPermissionsResponse;
  levelLabel: string;
  onSaved: () => void;
}

export function PermissionMatrixCard({ data, levelLabel, onSaved }: Props) {
  const [perms, setPerms] = useState<Record<string, true>>(data.permissions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function isOn(key: string) { return Boolean(perms[key]); }

  function toggle(key: string) {
    const next = { ...perms };
    if (next[key]) delete next[key]; else next[key] = true;
    setPerms(next);
  }

  async function save() {
    setSaving(true); setError(null);
    const r = await putLevelPermissions(data.level_id, perms);
    setSaving(false);
    if (!r.ok) {
      setError(r.error.code === 'invalid_permission_key'
        ? `Invalid key: ${(r.error.details as { key: string }).key}`
        : `Save failed (${r.error.code})`);
      return;
    }
    onSaved();
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{levelLabel}</h3>
        <span className="muted" style={{ fontSize: 12 }}>Level {data.level_number}</span>
      </header>

      {data.module_rows.length === 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          No Modules enabled yet — toggle Products on the Admin page first.
        </p>
      )}

      {data.module_rows.length > 0 && (
        <table style={{ width: '100%', fontSize: 13, marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Module × Data</th>
              <th>View</th><th>Create</th><th>Edit</th><th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {data.module_rows.map((row: ModuleRow) => (
              <tr key={`${row.module_key}.${row.bucket}`}>
                <td>{row.label} <span className="muted">— {row.bucket}</span></td>
                {(['view', 'create', 'edit', 'delete'] as const).map((v) => {
                  const supported = row.verbs.includes(v);
                  const key = `${row.module_key}.${row.bucket}.${v}`;
                  return (
                    <td key={v} style={{ textAlign: 'center' }}>
                      {supported ? (
                        <input type="checkbox" checked={isOn(key)} onChange={() => toggle(key)} disabled={saving} />
                      ) : <span className="muted">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 style={{ marginTop: 8, marginBottom: 6, fontSize: 13 }}>Platform</h4>
      <table style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Surface</th>
            <th>View</th><th>Create</th><th>Edit</th><th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {data.platform_rows.map((row: PlatformRow) => (
            <tr key={row.surface}>
              <td>{row.surface}</td>
              {(['view', 'create', 'edit', 'delete'] as const).map((v) => {
                const key = `_platform.${row.surface}.${v}`;
                return (
                  <td key={v} style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={isOn(key)} onChange={() => toggle(key)} disabled={saving} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
