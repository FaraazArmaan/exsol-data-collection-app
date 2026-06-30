// src/modules/ams/components/PermissionMatrixCard.tsx
//
// One Level's permission card: a single matrix table that banded-groups
// Modules (auto-generated from active Products × DataBuckets) and the
// fixed Platform surfaces. All four verb columns share fixed widths so
// the grid stays aligned. Save replaces the entire JSONB matrix.

import { Fragment, useState } from 'react';
import {
  putLevelPermissions,
  type LevelPermissionsResponse, type ModuleRow, type PlatformRow,
} from '../api';

interface Props {
  data: LevelPermissionsResponse;
  levelLabel: string;
  onSaved: () => void;
}

const VERBS = ['view', 'create', 'edit', 'delete'] as const;
type Verb = (typeof VERBS)[number];

function PermissionToggle({
  checked, onChange, disabled, ariaLabel,
}: { checked: boolean; onChange: () => void; disabled?: boolean; ariaLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className="toggle"
      onClick={onChange}
      disabled={disabled}
    >
      <span className="toggle-label toggle-label-on">ON</span>
      <span className="toggle-label toggle-label-off">OFF</span>
      <span className="toggle-knob" />
    </button>
  );
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

  const hasModules = data.module_rows.length > 0;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>{levelLabel}</h3>
        <span className="perm-level-chip">Level {data.level_number}</span>
      </header>

      <table className="perm-matrix">
        <colgroup>
          <col />
          <col style={{ width: 92 }} />
          <col style={{ width: 92 }} />
          <col style={{ width: 92 }} />
          <col style={{ width: 92 }} />
        </colgroup>
        <thead>
          <tr>
            <th>Resource</th>
            <th>View</th>
            <th>Create</th>
            <th>Edit</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          <tr className="perm-section-row"><td colSpan={5}>Modules</td></tr>
          {!hasModules && (
            <tr>
              <td colSpan={5} className="muted" style={{ padding: '12px' }}>
                No Modules enabled yet — toggle Products on the Admin page first.
              </td>
            </tr>
          )}
          {data.module_rows.map((row: ModuleRow) => (
            <tr key={`${row.module_key}.${row.bucket}`} className="perm-row">
              <td className="perm-resource">
                {row.label}<span className="perm-bucket">— {row.bucket}</span>
              </td>
              {VERBS.map((v: Verb) => {
                const supported = row.verbs.includes(v);
                const key = `${row.module_key}.${row.bucket}.${v}`;
                return (
                  <td key={v} className="perm-cell">
                    {supported ? (
                      <PermissionToggle
                        checked={isOn(key)}
                        onChange={() => toggle(key)}
                        disabled={saving}
                        ariaLabel={`${row.label} ${row.bucket} ${v}`}
                      />
                    ) : <span className="perm-cell-na">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}

          <tr className="perm-section-row"><td colSpan={5}>Platform</td></tr>
          {data.platform_rows.map((row: PlatformRow) => (
            <tr key={row.surface} className="perm-row">
              <td className="perm-resource">{row.surface}</td>
              {VERBS.map((v: Verb) => {
                const supported = row.verbs.includes(v);
                const key = `_platform.${row.surface}.${v}`;
                return (
                  <td key={v} className="perm-cell">
                    {supported ? (
                      <PermissionToggle
                        checked={isOn(key)}
                        onChange={() => toggle(key)}
                        disabled={saving}
                        ariaLabel={`platform ${row.surface} ${v}`}
                      />
                    ) : <span className="perm-cell-na">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}

          {(data.action_groups ?? []).map((group) => (
            <Fragment key={group.product_key}>
              <tr className="perm-section-row"><td colSpan={5}>{group.label}</td></tr>
              {group.actions.map((a) => (
                <tr key={a.key} className="perm-row">
                  <td className="perm-resource">{a.label}</td>
                  <td className="perm-cell" colSpan={4} style={{ textAlign: 'left' }}>
                    <PermissionToggle
                      checked={isOn(a.key)}
                      onChange={() => toggle(a.key)}
                      disabled={saving}
                      ariaLabel={a.label}
                    />
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div className="perm-card-footer">
        {error && <span className="error" style={{ margin: 0 }}>{error}</span>}
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
