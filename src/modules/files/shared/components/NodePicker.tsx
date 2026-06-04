import { useEffect, useState } from 'react';

interface NodeRow { id: string; display_name: string; level_number: number | null }

interface Props {
  clientId: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}

export function NodePicker({ clientId, value, onChange }: Props) {
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/user-nodes?client=${clientId}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setNodes(d.nodes ?? []))
      .catch(() => setNodes([]));
  }, [clientId]);

  if (!clientId) return <p style={{ color: '#888', fontSize: 12 }}>Admin vault — no nodes to pick.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' }}>
      {nodes.map((n) => {
        const checked = value.includes(n.id);
        const indent = n.level_number != null ? (n.level_number - 1) * 16 : 0;
        return (
          <label key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: indent }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onChange(checked ? value.filter((v) => v !== n.id) : [...value, n.id])}
            />
            <span>
              {n.display_name}{' '}
              {n.level_number != null && (
                <em style={{ color: '#888', fontSize: 10 }}>L{n.level_number}</em>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
