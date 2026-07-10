import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { listAuditLog, type AuditLogEntry, type AuditLogFilter } from '../api';
import { AuditFilters } from '../components/audit/AuditFilters';
import { AuditTable } from '../components/audit/AuditTable';
import { AuditDetailDrawer } from '../components/audit/AuditDetailDrawer';

const DEFAULT_PAGE_SIZE = 50;

interface Props {
  clientId?: string;
  backTo?: string;
}

export default function ClientAuditLog({ clientId: clientIdProp, backTo }: Props = {}) {
  // NB: hooks must run unconditionally — the empty-clientId early return lives
  // AFTER the hook block (rules-of-hooks; the route always provides clientId).
  const { clientId: routeClientId } = useParams<{ clientId: string }>();
  const clientId = clientIdProp ?? routeClientId;

  function makeDefault(): AuditLogFilter {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return { client_id: clientId ?? '', since: sevenDaysAgo.toISOString(), page: 1, page_size: DEFAULT_PAGE_SIZE };
  }

  const [draft, setDraft] = useState<AuditLogFilter>(makeDefault());
  const [applied, setApplied] = useState<AuditLogFilter>(makeDefault());
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const fetchData = useCallback(async (filter: AuditLogFilter) => {
    setLoading(true);
    setError(null);
    const r = await listAuditLog({ ...filter, client_id: clientId });
    if (!r.ok) { setError(r.error.code); setLoading(false); return; }
    setEntries(r.data.entries);
    setTotal(r.data.total);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void fetchData(applied); }, [applied, fetchData]);

  if (!clientId) return null;

  function apply() { setApplied({ ...draft, client_id: clientId, page: 1 }); }
  function changePage(p: number) { setApplied({ ...applied, page: p }); }

  return (
    <div style={{ maxWidth: 1200 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Workspace audit</h1>
        <Link to={backTo ?? `/clients/${clientId}`} className="btn btn-ghost">← back</Link>
      </header>
      <AuditFilters value={draft} onChange={setDraft} onApply={apply} hiddenClientId={clientId} />
      <AuditTable
        entries={entries}
        total={total}
        page={applied.page ?? 1}
        pageSize={applied.page_size ?? DEFAULT_PAGE_SIZE}
        loading={loading}
        error={error}
        onRowClick={setSelected}
        onPageChange={changePage}
      />
      <AuditDetailDrawer entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
