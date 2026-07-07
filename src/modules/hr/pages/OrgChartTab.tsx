import { useEffect, useMemo, useState } from 'react';
import { hrApi } from '../shared/api';
import type { OrgNode } from '../shared/types';

interface TreeNode extends OrgNode { children: TreeNode[] }

function buildForest(nodes: OrgNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  nodes.forEach((n) => byId.set(n.id, { ...n, children: [] }));
  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    const parent = n.parent_id ? byId.get(n.parent_id) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

function NodeRows({ node, depth, selectedId, onSelect }: {
  node: TreeNode; depth: number; selectedId: string | null; onSelect: (n: TreeNode) => void;
}) {
  return (
    <>
      <button
        type="button"
        className={`hr-node${selectedId === node.id ? ' is-selected' : ''}`}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        onClick={() => onSelect(node)}
      >
        <span className="hr-node-dot" style={{ background: node.role_color || 'var(--accent, #3b82f6)' }} />
        <span className="hr-node-name">{node.display_name}</span>
        <span className="hr-node-role">{node.role_label ?? '—'}</span>
        {!node.has_login && <span className="hr-node-badge">no login</span>}
      </button>
      {node.children.map((c) => (
        <NodeRows key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </>
  );
}

export default function OrgChartTab(_props: { slug: string }) {
  const [nodes, setNodes] = useState<OrgNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TreeNode | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    setNodes(null);
    hrApi.org()
      .then((r) => { if (alive) setNodes(r.nodes); })
      .catch((e) => { if (alive) setError((e as { code?: string })?.code ?? 'load_failed'); });
    return () => { alive = false; };
  }, []);

  const forest = useMemo(() => (nodes ? buildForest(nodes) : []), [nodes]);
  const byId = useMemo(() => new Map((nodes ?? []).map((n) => [n.id, n])), [nodes]);
  const reports = selected ? (nodes ?? []).filter((n) => n.parent_id === selected.id).length : 0;
  const manager = selected?.parent_id ? byId.get(selected.parent_id) : null;

  if (error) {
    return (
      <div className="hr-state hr-state-error" role="alert">
        Couldn't load the org chart ({error}).{' '}
        <button className="btn btn-ghost" onClick={() => location.reload()}>Retry</button>
      </div>
    );
  }
  if (nodes === null) return <div className="hr-state">Loading org chart…</div>;
  if (nodes.length === 0) {
    return (
      <div className="hr-state hr-empty">
        <strong>No people yet.</strong>
        <span>Add team members in Manage Team and they'll appear here.</span>
      </div>
    );
  }

  return (
    <div className="hr-org">
      <div className="hr-org-tree" role="tree" aria-label="Organisation chart">
        {forest.map((n) => (
          <NodeRows key={n.id} node={n} depth={0} selectedId={selected?.id ?? null} onSelect={setSelected} />
        ))}
      </div>
      {selected && (
        <aside className="hr-org-detail" aria-label="Person detail">
          <div className="hr-detail-head">
            <span className="hr-node-dot" style={{ background: selected.role_color || 'var(--accent, #3b82f6)' }} />
            <div>
              <div className="hr-detail-name">{selected.display_name}</div>
              <div className="hr-detail-sub">
                {selected.role_label ?? '—'}{selected.level_label ? ` · ${selected.level_label}` : ''}
              </div>
            </div>
            <button className="btn btn-ghost hr-detail-close" onClick={() => setSelected(null)} aria-label="Close">✕</button>
          </div>
          <dl className="hr-detail-fields">
            {selected.email && (<><dt>Email</dt><dd><a href={`mailto:${selected.email}`}>{selected.email}</a></dd></>)}
            {selected.phone && (<><dt>Phone</dt><dd>{selected.phone}</dd></>)}
            <dt>Direct reports</dt><dd>{reports}</dd>
            {manager && (<><dt>Manager</dt><dd>{manager.display_name}</dd></>)}
            <dt>Login</dt><dd>{selected.has_login ? 'Active' : 'No login'}</dd>
          </dl>
        </aside>
      )}
    </div>
  );
}
