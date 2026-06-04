// Recursive tree renderer for user_nodes within a single bucket. Cross-bucket
// parents aren't drawn — a user whose parent has a different bucket_family is
// treated as a root within this bucket (no visual edge).

import type { UserNode, ClientRole } from '../../api';

interface Props {
  nodes: UserNode[];                    // ALL nodes for this client (parent lookup needs everything)
  rolesById: Record<string, ClientRole>;
  bucket: 'business' | 'employees' | 'customers' | 'products' | 'other';
  depth?: number;
  parentId?: string | null;
}

function bucketOf(node: UserNode, rolesById: Record<string, ClientRole>): string {
  const role = rolesById[node.role_id];
  return role?.bucket_family ?? 'other';
}

export function UserNodeTree({ nodes, rolesById, bucket, depth = 0, parentId = null }: Props) {
  // First call: parentId is null → find this-bucket nodes whose parent is null
  // OR whose parent isn't in this bucket (cross-bucket parents = local roots).
  // Recursive call: parentId is set → render this-bucket children of that node.
  const inBucket = nodes.filter((n) => bucketOf(n, rolesById) === bucket);
  let visible: UserNode[];
  if (depth === 0) {
    visible = inBucket.filter((n) => {
      if (n.parent_id === null) return true;
      const parent = nodes.find((p) => p.id === n.parent_id);
      if (!parent) return true;
      return bucketOf(parent, rolesById) !== bucket;
    });
  } else {
    visible = inBucket.filter((n) => n.parent_id === parentId);
  }
  visible.sort((a, b) =>
    (a.level_number ?? 0) - (b.level_number ?? 0)
    || a.sort_order - b.sort_order
    || a.created_at.localeCompare(b.created_at),
  );

  if (visible.length === 0 && depth === 0) {
    return <p className="muted" style={{ fontSize: 12, margin: '4px 0 0 12px' }}>— empty —</p>;
  }

  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, paddingLeft: depth === 0 ? 0 : 18 }}>
      {visible.map((n) => {
        const role = rolesById[n.role_id];
        const color = role?.color ?? '#888888';
        return (
          <li key={n.id} style={{ margin: '4px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{
                width: 8, height: 8, borderRadius: 4, background: color,
                flexShrink: 0,
              }} />
              <span style={{ fontWeight: 500 }}>{n.display_name}</span>
              {role && (
                <span className="muted" style={{ fontSize: 11 }}>
                  · {role.label}
                </span>
              )}
              {n.email && (
                <span className="muted" style={{ fontSize: 11 }}>
                  · {n.email}
                </span>
              )}
              {n.has_login && <span title="Has login" style={{ fontSize: 11 }}>🔑</span>}
            </div>
            <UserNodeTree
              nodes={nodes}
              rolesById={rolesById}
              bucket={bucket}
              depth={depth + 1}
              parentId={n.id}
            />
          </li>
        );
      })}
    </ul>
  );
}
