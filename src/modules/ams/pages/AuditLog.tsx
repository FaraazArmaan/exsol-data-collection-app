import { useCallback, useEffect, useState } from 'react';
import { listAuditLog, listClients, type AuditLogEntry, type AuditLogFilter, type ClientSummary } from '../api';
import { AuditFilters } from '../components/audit/AuditFilters';
import { AuditTable } from '../components/audit/AuditTable';
import { AuditDetailDrawer } from '../components/audit/AuditDetailDrawer';

const DEFAULT_PAGE_SIZE = 50;

function defaultFilter(): AuditLogFilter {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return { since: sevenDaysAgo.toISOString(), page: 1, page_size: DEFAULT_PAGE_SIZE };
}

export default function AuditLog() {
  const [draft, setDraft] = useState<AuditLogFilter>(defaultFilter());
  const [applied, setApplied] = useState<AuditLogFilter>(defaultFilter());
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const fetchData = useCallback(async (filter: AuditLogFilter) => {
    setLoading(true);
    setError(null);
    const r = await listAuditLog(filter);
    if (!r.ok) { setError(r.error.code); setLoading(false); return; }
    setEntries(r.data.entries);
    setTotal(r.data.total);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchData(applied); }, [applied, fetchData]);

  useEffect(() => {
    void (async () => {
      const r = await listClients();
      if (r.ok) setClients(r.data.clients);
    })();
  }, []);

  function apply() { setApplied({ ...draft, page: 1 }); }
  function changePage(p: number) { setApplied({ ...applied, page: p }); }

  return (
    <div style={{ maxWidth: 1200 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Audit log</h1>
        <span className="muted" style={{ fontSize: 13 }}>All admin + bucket-user actions</span>
      </header>
      <AuditFilters value={draft} onChange={setDraft} onApply={apply} clients={clients} />
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
