import { useEffect, useState } from 'react';

// Roles are served via /api/client-structure (GET), not /api/client-roles (POST-only).
// The roles array uses `label` as the display field, not `name`.
interface RoleRow { id: string; label: string; bucket_family: string | null }

interface Props {
  clientId: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}

export function RolePicker({ clientId, value, onChange }: Props) {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/client-structure?client=${clientId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setRoles(d.roles ?? []))
      .catch(() => setRoles([]));
  }, [clientId]);

  if (!clientId) return <p style={{ color: '#888', fontSize: 12 }}>Admin vault — no roles to pick.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {roles.map((r) => {
        const checked = value.includes(r.id);
        return (
          <label key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                onChange(checked ? value.filter((v) => v !== r.id) : [...value, r.id]);
              }}
            />
            <span>{r.label} {r.bucket_family ? <em style={{ color: '#888' }}>({r.bucket_family})</em> : null}</span>
          </label>
        );
      })}
    </div>
  );
}
