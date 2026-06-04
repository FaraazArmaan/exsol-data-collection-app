import { useEffect, useState } from 'react';

interface UserRow { id: string; display_name: string; email: string | null }

interface Props {
  clientId: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}

export function UserPicker({ clientId, value, onChange }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/user-nodes?client=${clientId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setUsers((d.nodes as UserRow[]) ?? []))
      .catch(() => setUsers([]));
  }, [clientId]);

  if (!clientId) return <p style={{ color: '#888', fontSize: 12 }}>Admin vault — no users to pick.</p>;

  const filtered = q
    ? users.filter((u) => u.display_name.toLowerCase().includes(q.toLowerCase()) ||
                          (u.email ?? '').toLowerCase().includes(q.toLowerCase()))
    : users;

  return (
    <div>
      <input
        placeholder="Search…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', marginBottom: 6, padding: 6 }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' }}>
        {filtered.map((u) => {
          const checked = value.includes(u.id);
          return (
            <label key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(checked ? value.filter((v) => v !== u.id) : [...value, u.id])}
              />
              <span>{u.display_name} <em style={{ color: '#888', fontSize: 10 }}>{u.email}</em></span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
