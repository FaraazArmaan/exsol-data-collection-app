// One bucket box under a client. Shows icon + label + count + tree of users
// whose role.bucket_family matches this bucket.

import type { UserNode, ClientRole } from '../../api';
import { UserNodeTree } from './UserNodeTree';

export type BucketKey = 'business' | 'employees' | 'customers' | 'products' | 'other';

const BUCKET_ICON: Record<BucketKey, string> = {
  business: '🏢',
  employees: '👥',
  customers: '🛍️',
  products: '📦',
  other: '📁',
};

const BUCKET_LABEL: Record<BucketKey, string> = {
  business: 'business',
  employees: 'employees',
  customers: 'customers',
  products: 'products',
  other: 'other',
};

interface Props {
  bucket: BucketKey;
  nodes: UserNode[];
  rolesById: Record<string, ClientRole>;
}

export function BucketSection({ bucket, nodes, rolesById }: Props) {
  const inBucket = nodes.filter((n) => {
    const role = rolesById[n.role_id];
    const family = role?.bucket_family ?? 'other';
    return family === bucket;
  });
  // Don't render the 'other' bucket when empty (keeps the four canonical
  // buckets visible at all times for layout consistency).
  if (bucket === 'other' && inBucket.length === 0) return null;
  return (
    <div style={{
      border: '1px solid var(--border-subtle, #2a2a2a)',
      borderRadius: 6,
      padding: 10,
      background: 'var(--bg-elevated, #1a1a1a)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>{BUCKET_ICON[bucket]}</span>
        <strong style={{ fontSize: 13 }}>{BUCKET_LABEL[bucket]}</strong>
        <span className="muted" style={{ fontSize: 11 }}>· {inBucket.length}</span>
      </div>
      <UserNodeTree nodes={nodes} rolesById={rolesById} bucket={bucket} />
    </div>
  );
}
