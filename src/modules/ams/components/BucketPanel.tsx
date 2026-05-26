import { useEffect, useState } from 'react';
import { listBucketUsers, deleteBucketUser, type BucketSummary, type BucketUser } from '../api';
import { AddUserModal } from './AddUserModal';
import { EditUserModal } from './EditUserModal';
import { LoginManageModal } from './LoginManageModal';

interface Props {
  clientId: string;
  clientSlug: string;
  bucket: BucketSummary;
  initialOpen: boolean;
  onChange: () => void;
}

export function BucketPanel({ clientId, clientSlug, bucket, initialOpen, onChange }: Props) {
  const [open, setOpen] = useState(initialOpen);
  const [users, setUsers] = useState<BucketUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingUser, setEditingUser] = useState<BucketUser | null>(null);
  const [loginUser, setLoginUser] = useState<BucketUser | null>(null);

  async function refreshUsers() {
    setLoading(true);
    const r = await listBucketUsers(clientId, bucket.role);
    setLoading(false);
    if (r.ok) setUsers(r.data.users);
  }

  useEffect(() => {
    if (open && users.length === 0 && !loading) void refreshUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleDelete(user: BucketUser) {
    if (!confirm(`Delete ${user.display_name}?`)) return;
    const r = await deleteBucketUser(clientId, bucket.role, user.id);
    if (!r.ok) {
      alert(`Delete failed: ${r.error.code}`);
      return;
    }
    await refreshUsers();
    onChange();
  }

  const isSingleton = bucket.cardinality === 'singleton';
  const addDisabled = isSingleton && bucket.count >= 1;
  const listColumns = bucket.columns.filter((c) => c.display_in_list);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <header
        onClick={() => setOpen(!open)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', marginBottom: open ? 16 : 0 }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>
          <span style={{ marginRight: 8, color: 'var(--text-secondary)' }}>{open ? '▾' : '▸'}</span>
          {bucket.label}
        </h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {isSingleton ? `${bucket.count} / 1` : `${bucket.count}`}
        </span>
      </header>

      {open && (
        <>
          {loading && <p className="muted">Loading…</p>}
          {!loading && users.length === 0 && (
            <p className="muted" style={{ margin: '0 0 16px' }}>None yet.</p>
          )}
          {!loading && users.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-subtle)' }}>
                  <th style={{ padding: '4px 8px' }}>Name</th>
                  <th style={{ padding: '4px 8px' }}>Email</th>
                  {listColumns.map((c) => (
                    <th key={c.key} style={{ padding: '4px 8px' }}>{c.label}</th>
                  ))}
                  <th style={{ padding: '4px 8px', width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: 0, fontSize: 13 }}
                        onClick={() => setEditingUser(u)}
                      >
                        {u.display_name}
                      </button>
                    </td>
                    <td style={{ padding: '6px 8px' }} className="muted">{u.email ?? '—'}</td>
                    {listColumns.map((c) => (
                      <td key={c.key} style={{ padding: '6px 8px' }}>{formatCell(u[c.key], c.type)}</td>
                    ))}
                    <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '0 4px', fontSize: 13 }}
                        onClick={() => setLoginUser(u)}
                        title={u.email ? 'Manage login' : 'Add an email first'}
                      >
                        🔑
                      </button>
                      <button className="btn btn-ghost" style={{ padding: '0 4px', fontSize: 13 }} onClick={() => handleDelete(u)}>
                        × delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => setShowAdd(true)}
            disabled={addDisabled}
            title={addDisabled ? 'Singleton role is already filled' : undefined}
          >
            + Add {bucket.label}
          </button>
        </>
      )}

      {showAdd && (
        <AddUserModal
          clientId={clientId}
          clientSlug={clientSlug}
          bucket={bucket}
          onClose={() => setShowAdd(false)}
          onCreated={async () => { setShowAdd(false); await refreshUsers(); onChange(); }}
        />
      )}
      {editingUser && (
        <EditUserModal
          clientId={clientId}
          bucket={bucket}
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={async () => { setEditingUser(null); await refreshUsers(); onChange(); }}
        />
      )}
      {loginUser && (
        <LoginManageModal
          clientId={clientId}
          clientSlug={clientSlug}
          role={bucket.role}
          user={loginUser}
          onClose={() => setLoginUser(null)}
          onChanged={() => { onChange(); }}
        />
      )}
    </div>
  );
}

function formatCell(v: unknown, type: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'boolean') return v ? '✓' : '—';
  if (type === 'date' && typeof v === 'string') return v.slice(0, 10);
  return String(v);
}
