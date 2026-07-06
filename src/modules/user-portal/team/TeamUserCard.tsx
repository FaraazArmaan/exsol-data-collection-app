// Compact draggable user card for Manage Team.
//
// Drag listeners live on the grip HANDLE only — not the whole card — so the
// card body stays tappable/scrollable on touch. The dnd id format and data
// payload are byte-identical to UserNodeChip's (node:<id> + {nodeId,
// currentParent, currentLevel, roleId}) so UserManageTeam's onDragEnd and the
// server calls are untouched.

import type { KeyboardEvent, MouseEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { ClientRole, UserNode } from './api';

interface Props {
  node: UserNode;
  role: ClientRole | undefined;
  onClick: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export function TeamUserCard({ node, role, onClick, selectMode, selected, onToggleSelect }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `node:${node.id}`,
    data: { nodeId: node.id, currentParent: node.parent_id, currentLevel: node.level_number, roleId: node.role_id },
    disabled: selectMode === true,
  });
  const color = role?.color ?? '#888888';

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    if (selectMode) {
      onToggleSelect?.(node.id);
      return;
    }
    onClick();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (selectMode) onToggleSelect?.(node.id);
      else onClick();
    }
  }

  const classes = [
    'mt-card',
    isDragging ? 'mt-card--dragging' : '',
    selectMode && selected ? 'mt-card--selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={setNodeRef}
      className={classes}
      style={{
        ['--mt-role' as string]: color,
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
      }}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={node.email ?? undefined}
    >
      <div className="mt-card-head">
        {selectMode ? (
          <span className={`mt-card-check${selected ? ' mt-card-check--on' : ''}`} aria-hidden>
            {selected ? '✓' : ''}
          </span>
        ) : (
          <span
            className="mt-card-grip"
            {...listeners}
            {...attributes}
            aria-label={`Drag ${node.display_name} to another level`}
            onClick={(e) => e.stopPropagation()}
          >
            <svg width="8" height="13" viewBox="0 0 8 13" aria-hidden>
              <circle cx="1.5" cy="1.5" r="1.5" /><circle cx="6.5" cy="1.5" r="1.5" />
              <circle cx="1.5" cy="6.5" r="1.5" /><circle cx="6.5" cy="6.5" r="1.5" />
              <circle cx="1.5" cy="11.5" r="1.5" /><circle cx="6.5" cy="11.5" r="1.5" />
            </svg>
          </span>
        )}
        <span className="mt-card-name">{node.display_name}</span>
        {node.has_login && <span className="mt-card-badge" title="Has login">🔑</span>}
        {node.has_reset_request && <span className="mt-card-badge" title="Password reset requested">🔔</span>}
      </div>
      {(node.email || role || node.phone) && (
        <div className="mt-card-details">
          {node.email && <span className="mt-card-detail">{node.email}</span>}
          {role && <span className="mt-card-detail">{role.label}</span>}
          {node.phone && <span className="mt-card-detail">{node.phone}</span>}
        </div>
      )}
    </div>
  );
}
