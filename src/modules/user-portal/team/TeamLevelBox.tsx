// One box per access level: header band (level eyebrow + "under <parent>"
// caption + count), then a responsive grid of TeamUserCards. Droppable
// surface for dnd — dropId format ('level:<n>' / 'unassigned') is unchanged
// from the old LevelRow so UserManageTeam's onDragEnd keeps working verbatim.

import { useDroppable } from '@dnd-kit/core';
import { TeamUserCard } from './TeamUserCard';
import type { ClientRole, UserNode } from './api';

interface Props {
  dropId: string;             // e.g. 'level:3' or 'unassigned'
  title: string;
  subtitle?: string;
  nodes: UserNode[];
  rolesById: Record<string, ClientRole>;
  onChipClick: (node: UserNode) => void;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

export function TeamLevelBox({
  dropId, title, subtitle, nodes, rolesById, onChipClick,
  selectMode, selectedIds, onToggleSelect,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  return (
    <section ref={setNodeRef} className={`mt-box${isOver ? ' mt-box--over' : ''}`}>
      <header className="mt-box-head">
        <h4 className="mt-box-title">
          {title}
          {subtitle && <span className="mt-box-caption">{subtitle}</span>}
        </h4>
        <span className="mt-box-count">{nodes.length === 1 ? '1 user' : `${nodes.length} users`}</span>
      </header>
      {nodes.length === 0 ? (
        <p className="mt-box-empty">No users here yet — drag someone in, or use + Add user.</p>
      ) : (
        <div className="mt-grid">
          {nodes.map((n) => (
            <TeamUserCard
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
      )}
    </section>
  );
}
