import type { AuditLogFilter, ClientSummary } from '../../api';

interface Props {
  value: AuditLogFilter;
  onChange: (f: AuditLogFilter) => void;
  onApply: () => void;
  /** When defined, the client dropdown is hidden (per-client page pre-filters). */
  hiddenClientId?: string;
  clients?: ClientSummary[];
}

const KNOWN_OPS = [
  'client.created', 'client.updated', 'client.deleted', 'client.onboarded',
  'role.created', 'role.updated', 'role.deleted',
  'level.created', 'level.updated', 'level.deleted',
  'cardinality.replaced', 'products.replaced', 'permissions.updated',
  'user_node.created', 'user_node.updated', 'user_node.deleted', 'user_node.moved',
  'credential.peeked', 'credential.reset', 'credential.deleted',
  'admin.created', 'admin.updated', 'admin.deleted',
];

export function AuditFilters({ value, onChange, onApply, hiddenClientId, clients }: Props) {
  function patch(p: Partial<AuditLogFilter>) {
    onChange({ ...value, ...p });
  }

  return (
    <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
        Op
        <select value={value.op ?? ''} onChange={(e) => patch({ op: e.target.value || undefined })}>
          <option value="">Any</option>
          {KNOWN_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
        </select>
      </label>

      {!hiddenClientId && (
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          Client
          <select value={value.client_id ?? ''} onChange={(e) => patch({ client_id: e.target.value || undefined })}>
            <option value="">Any</option>
            {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
        Target type
        <select value={value.target_type ?? ''} onChange={(e) => patch({ target_type: e.target.value || undefined })}>
          <option value="">Any</option>
          <option value="client">client</option>
          <option value="role">role</option>
          <option value="level">level</option>
          <option value="user_node">user_node</option>
          <option value="admin">admin</option>
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
        Since
        <input type="datetime-local" value={toLocal(value.since)} onChange={(e) => patch({ since: fromLocal(e.target.value) })} />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
        Until
        <input type="datetime-local" value={toLocal(value.until)} onChange={(e) => patch({ until: fromLocal(e.target.value) })} />
      </label>

      <button type="button" className="btn btn-primary" onClick={onApply}>Apply</button>
    </div>
  );
}

function toLocal(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocal(local: string): string | undefined {
  if (!local) return undefined;
  return new Date(local).toISOString();
}
