import { useDroppable } from '@dnd-kit/core';
import { UserNodeChip } from './UserNodeChip';
import type { ClientRole, UserNode } from '../api';

interface Props {
  dropId: string;             // e.g. 'level:3' or 'unassigned'
  title: string;
  subtitle?: string;
  countLabel?: string;
  nodes: UserNode[];
  rolesById: Record<string, ClientRole>;
  onChipClick: (node: UserNode) => void;
  warning?: boolean;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

export function LevelRow({
  dropId, title, subtitle, countLabel, nodes, rolesById, onChipClick, warning,
  selectMode, selectedIds, onToggleSelect,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  return (
    <div
      ref={setNodeRef}
      style={{
        padding: 12, marginBottom: 12, borderRadius: 6,
        background: isOver ? 'rgba(59,130,246,0.1)' : 'var(--bg-elevated, #1a1a1a)',
        border: `1px dashed ${isOver ? 'var(--accent, #3b82f6)' : 'var(--border-subtle, #2a2a2a)'}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 14 }}>
          {title}
          {subtitle && <span className="muted" style={{ fontSize: 12, fontWeight: 'normal', marginLeft: 8 }}>{subtitle}</span>}
        </h4>
        {countLabel && (
          <span className="muted" style={{ fontSize: 12, color: warning ? 'var(--danger, #ef4444)' : undefined }}>
            {countLabel}
          </span>
        )}
      </div>
      <div style={{ minHeight: 32 }}>
        {nodes.length === 0
          ? <span className="muted" style={{ fontSize: 12 }}>—</span>
          : nodes.map((n) => (
              <UserNodeChip
                key={n.id}
                node={n}
                role={rolesById[n.role_id]}
                onClick={() => onChipClick(n)}
                selectMode={selectMode}
                selected={selectedIds?.has(n.id) ?? false}
                onToggleSelect={onToggleSelect}
              />
            ))}
      </div>
    </div>
  );
}
