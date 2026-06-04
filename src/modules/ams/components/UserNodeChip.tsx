import type { CSSProperties, MouseEvent } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { ClientRole, UserNode } from '../api';

interface Props {
  node: UserNode;
  role: ClientRole | undefined;
  onClick: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export function UserNodeChip({ node, role, onClick, selectMode, selected, onToggleSelect }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `node:${node.id}`,
    data: { nodeId: node.id, currentParent: node.parent_id, currentLevel: node.level_number, roleId: node.role_id },
    disabled: selectMode === true,
  });
  const color = role?.color ?? '#888888';
  const style: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', borderRadius: 14,
    cursor: selectMode ? 'pointer' : 'grab',
    background: `${color}22`,
    border: `1px solid ${color}`,
    color: '#fff',
    fontSize: 13, marginRight: 6, marginBottom: 6,
    opacity: isDragging ? 0.4 : 1,
    outline: selectMode && selected ? '2px solid #3b82f6' : undefined,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };
  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    if (selectMode) {
      onToggleSelect?.(node.id);
      return;
    }
    onClick();
  }
  return (
    <span
      ref={setNodeRef}
      {...(selectMode ? {} : listeners)}
      {...(selectMode ? {} : attributes)}
      style={style}
      onClick={handleClick}
      title={node.email ?? undefined}
    >
      {selectMode && (
        <span style={{
          width: 14, height: 14, borderRadius: 3,
          border: '1px solid #fff',
          background: selected ? '#3b82f6' : 'transparent',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, lineHeight: 1,
        }}>
          {selected ? '✓' : ''}
        </span>
      )}
      <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
      {node.display_name}
      {node.has_login && <span title="Has login">🔑</span>}
      {node.has_reset_request && <span title="Password reset requested">🔔</span>}
    </span>
  );
}
