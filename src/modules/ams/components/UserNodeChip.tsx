import type { CSSProperties } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { ClientRole, UserNode } from '../api';

interface Props {
  node: UserNode;
  role: ClientRole | undefined;
  onClick: () => void;
}

export function UserNodeChip({ node, role, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `node:${node.id}`,
    data: { nodeId: node.id, currentParent: node.parent_id, currentLevel: node.level_number, roleId: node.role_id },
  });
  const color = role?.color ?? '#888888';
  const style: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', borderRadius: 14, cursor: 'grab',
    background: `${color}22`, border: `1px solid ${color}`, color: '#fff',
    fontSize: 13, marginRight: 6, marginBottom: 6,
    opacity: isDragging ? 0.4 : 1,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
  };
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={style}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={node.email ?? undefined}
    >
      <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
      {node.display_name}
      {node.has_login && <span title="Has login">🔑</span>}
      {node.has_reset_request && <span title="Password reset requested">🔔</span>}
    </span>
  );
}
