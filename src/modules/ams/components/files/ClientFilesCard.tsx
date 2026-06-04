// Raw "tree command" style file structure for one workspace. Monospace
// font, click-to-collapse, persistent expand state across the 5s repoll.
//
// Hierarchy:
//   📁 Workspace
//      🏢 business         ← always 4 buckets, empty ones included
//      👥 employees
//         👤 Owner          ← user_nodes from this client whose role's
//            👤 Manager        bucket_family matches this bucket. Tree
//               · Stylist     follows parent_id pointers within the bucket;
//               · Stylist     cross-bucket parents make the child a local
//            👤 Manager        root within its own bucket.
//      🛍️ customers
//      📦 products

import { useEffect, useMemo, useState } from 'react';
import {
  getClientStructure, listUserNodes,
  type ClientSummary, type ClientRole, type UserNode,
} from '../../api';

const POLL_MS = 5000;

type BucketKey = 'business' | 'employees' | 'customers' | 'products' | 'other';

const BUCKETS: BucketKey[] = ['business', 'employees', 'customers', 'products', 'other'];
const BUCKET_ICON: Record<BucketKey, string> = {
  business: '🏢', employees: '👥', customers: '🛍️', products: '📦', other: '📂',
};

interface Props {
  client: ClientSummary;
}

export function ClientFilesCard({ client }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([client.id]));
  const [nodes, setNodes] = useState<UserNode[]>([]);
  const [roles, setRoles] = useState<ClientRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  const isWorkspaceOpen = expanded.has(client.id);

  async function fetchOnce() {
    setError(null);
    const [structRes, nodesRes] = await Promise.all([
      getClientStructure(client.id),
      listUserNodes(client.id),
    ]);
    if (!structRes.ok) { setError(`structure: ${structRes.error.code}`); return; }
    if (!nodesRes.ok) { setError(`nodes: ${nodesRes.error.code}`); return; }
    setRoles(structRes.data.roles);
    setNodes(nodesRes.data.nodes);
    setLastFetched(Date.now());
  }

  useEffect(() => {
    if (!isWorkspaceOpen) return;
    void fetchOnce();
    const id = window.setInterval(() => { void fetchOnce(); }, POLL_MS);
    return () => { window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWorkspaceOpen, client.id]);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const rolesById = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.id, r])) as Record<string, ClientRole>,
    [roles],
  );

  function bucketOf(node: UserNode): BucketKey {
    const fam = rolesById[node.role_id]?.bucket_family ?? null;
    if (fam === 'business' || fam === 'employees' || fam === 'customers' || fam === 'products') return fam;
    return 'other';
  }

  return (
    <div style={{
      fontFamily: 'var(--font-mono, ui-monospace, "SF Mono", Menlo, monospace)',
      fontSize: 13,
      lineHeight: 1.55,
      marginBottom: 4,
    }}>
      {/* Workspace row */}
      <TreeRow
        depth={0}
        glyph={isWorkspaceOpen ? '▾' : '▸'}
        icon="📁"
        label={client.name}
        meta={<>
          <code className="muted" style={{ fontSize: 11 }}>{client.slug}</code>
          {isWorkspaceOpen && <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
            · {nodes.length} user{nodes.length === 1 ? '' : 's'}
            {lastFetched && ` · ↻ ${secondsAgo(lastFetched)}`}
          </span>}
        </>}
        onClick={() => toggle(client.id)}
      />

      {error && isWorkspaceOpen && (
        <p className="error" style={{ fontSize: 12, paddingLeft: 24 }}>{error}</p>
      )}

      {/* Buckets */}
      {isWorkspaceOpen && BUCKETS.map((bucket) => {
        if (bucket === 'other') {
          // Hide 'other' bucket entirely when empty so the canonical 4 stay tidy.
          const any = nodes.some((n) => bucketOf(n) === 'other');
          if (!any) return null;
        }
        const bucketKey = `${client.id}:${bucket}`;
        const bucketOpen = expanded.has(bucketKey);
        const inBucket = nodes.filter((n) => bucketOf(n) === bucket);
        return (
          <div key={bucket}>
            <TreeRow
              depth={1}
              glyph={inBucket.length === 0 ? '·' : (bucketOpen ? '▾' : '▸')}
              icon={BUCKET_ICON[bucket]}
              label={bucket}
              meta={<span className="muted" style={{ fontSize: 11 }}>· {inBucket.length}</span>}
              onClick={inBucket.length > 0 ? () => toggle(bucketKey) : undefined}
              muted={inBucket.length === 0}
            />
            {bucketOpen && inBucket.length > 0 && (
              <Subtree
                depth={2}
                parentId={null}
                bucket={bucket}
                nodes={nodes}
                rolesById={rolesById}
                bucketOfFn={bucketOf}
                expandedSet={expanded}
                onToggle={toggle}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface SubtreeProps {
  depth: number;
  parentId: string | null;
  bucket: BucketKey;
  nodes: UserNode[];
  rolesById: Record<string, ClientRole>;
  bucketOfFn: (n: UserNode) => BucketKey;
  expandedSet: Set<string>;
  onToggle: (key: string) => void;
}

function Subtree({
  depth, parentId, bucket, nodes, rolesById, bucketOfFn, expandedSet, onToggle,
}: SubtreeProps) {
  // Roots within this bucket: parent_id null, OR parent isn't in this bucket.
  let visible: UserNode[];
  if (parentId === null) {
    visible = nodes.filter((n) => {
      if (bucketOfFn(n) !== bucket) return false;
      if (n.parent_id === null) return true;
      const parent = nodes.find((p) => p.id === n.parent_id);
      return !parent || bucketOfFn(parent) !== bucket;
    });
  } else {
    visible = nodes.filter((n) => n.parent_id === parentId && bucketOfFn(n) === bucket);
  }
  visible.sort((a, b) =>
    (a.level_number ?? 0) - (b.level_number ?? 0)
    || a.sort_order - b.sort_order
    || a.created_at.localeCompare(b.created_at),
  );

  return (
    <>
      {visible.map((n) => {
        const role = rolesById[n.role_id];
        const hasChildren = nodes.some((c) => c.parent_id === n.id && bucketOfFn(c) === bucket);
        const open = expandedSet.has(n.id);
        const glyph = hasChildren ? (open ? '▾' : '▸') : '·';
        return (
          <div key={n.id}>
            <TreeRow
              depth={depth}
              glyph={glyph}
              icon="👤"
              label={n.display_name}
              meta={<>
                {role && <span className="muted" style={{ fontSize: 11 }}>· {role.label}</span>}
                {n.email && <span className="muted" style={{ fontSize: 11 }}> · {n.email}</span>}
                {n.has_login && <span title="Has login" style={{ fontSize: 11, marginLeft: 4 }}>🔑</span>}
              </>}
              onClick={hasChildren ? () => onToggle(n.id) : undefined}
              roleColor={role?.color}
            />
            {hasChildren && open && (
              <Subtree
                depth={depth + 1}
                parentId={n.id}
                bucket={bucket}
                nodes={nodes}
                rolesById={rolesById}
                bucketOfFn={bucketOfFn}
                expandedSet={expandedSet}
                onToggle={onToggle}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

interface TreeRowProps {
  depth: number;
  glyph: string;
  icon: string;
  label: string;
  meta?: React.ReactNode;
  onClick?: () => void;
  muted?: boolean;
  roleColor?: string;
}

function TreeRow({ depth, glyph, icon, label, meta, onClick, muted, roleColor }: TreeRowProps) {
  const clickable = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } } : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        paddingLeft: depth * 18,
        cursor: clickable ? 'pointer' : 'default',
        opacity: muted ? 0.55 : 1,
        userSelect: 'none',
      }}
    >
      <span style={{ width: 12, display: 'inline-block', textAlign: 'center', color: 'var(--text-muted, #888)' }}>{glyph}</span>
      {roleColor && (
        <span style={{ width: 8, height: 8, borderRadius: 4, background: roleColor, flexShrink: 0 }} />
      )}
      <span>{icon}</span>
      <span>{label}</span>
      {meta && <span style={{ marginLeft: 4 }}>{meta}</span>}
    </div>
  );
}

function secondsAgo(t: number): string {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}
