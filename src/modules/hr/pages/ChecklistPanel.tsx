import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { hrApi } from '../shared/api';
import type {
  ChecklistKind, ChecklistTemplate, ChecklistInstanceSummary, ChecklistItem, OrgNode,
} from '../shared/types';

export interface ChecklistPanelProps {
  kind: ChecklistKind;
  perms: ReadonlySet<string>;
  startLabel: string;
  subjectLabel: string;
  emptyHint: string;
  // Offboarding supplies action buttons for action_hint items (Feature 5).
  renderItemAction?: (item: ChecklistItem, ctx: { subjectId: string | null; instanceId: string; refresh: () => void }) => ReactNode;
}

export default function ChecklistPanel({ kind, perms, startLabel, subjectLabel, emptyHint, renderItemAction }: ChecklistPanelProps) {
  const canEdit = perms.has('hr.employees.edit') || perms.has('hr.employees.create');
  const [instances, setInstances] = useState<ChecklistInstanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [subject, setSubject] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ instance: ChecklistInstanceSummary; items: ChecklistItem[] } | null>(null);

  const loadList = useCallback(() => {
    setError(null);
    hrApi.instances(kind)
      .then((r) => setInstances(r.instances))
      .catch((e) => setError((e as { code?: string })?.code ?? 'load_failed'));
  }, [kind]);

  useEffect(() => {
    setInstances(null);
    setOpenId(null);
    loadList();
    hrApi.org().then((r) => setNodes(r.nodes)).catch(() => setNodes([]));
    hrApi.templates(kind).then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
  }, [kind, loadList]);

  const openDetail = useCallback((id: string) => {
    setOpenId(id);
    setDetail(null);
    hrApi.instance(id).then((r) => setDetail(r)).catch(() => setDetail(null));
  }, []);

  async function start() {
    if (!subject || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await hrApi.startInstance(kind, subject, templateId || null);
      setSubject('');
      setTemplateId('');
      loadList();
      openDetail(id);
    } catch (e) {
      setError((e as { code?: string })?.code ?? 'start_failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: ChecklistItem) {
    if (!openId || !canEdit) return;
    await hrApi.toggleItem(openId, item.id, !item.done).catch(() => {});
    openDetail(openId);
    loadList();
  }

  async function complete() {
    if (!openId) return;
    await hrApi.completeInstance(openId).catch(() => {});
    openDetail(openId);
    loadList();
  }

  const refresh = () => { loadList(); if (openId) openDetail(openId); };

  if (error && !instances) {
    return (
      <div className="hr-state hr-state-error" role="alert">
        Couldn't load ({error}). <button className="btn btn-ghost" onClick={loadList}>Retry</button>
      </div>
    );
  }
  if (instances === null) return <div className="hr-state">Loading…</div>;

  return (
    <div className="hr-checklist">
      {canEdit && (
        <div className="hr-start">
          <select className="hr-input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label={subjectLabel}>
            <option value="">{subjectLabel}…</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>{n.display_name}{n.role_label ? ` — ${n.role_label}` : ''}</option>
            ))}
          </select>
          <select className="hr-input" value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Checklist template">
            <option value="">Default checklist</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.item_count})</option>)}
          </select>
          <button className="btn btn-primary" disabled={!subject || busy} onClick={start}>{startLabel}</button>
        </div>
      )}
      {error && <div className="hr-state hr-state-error" role="alert">{error}</div>}

      {instances.length === 0 ? (
        <div className="hr-state hr-empty"><strong>Nothing in progress.</strong><span>{emptyHint}</span></div>
      ) : (
        <ul className="hr-inst-list">
          {instances.map((i) => {
            const pct = i.total ? Math.round((i.done / i.total) * 100) : 0;
            return (
              <li key={i.id} className={`hr-inst${openId === i.id ? ' is-open' : ''}`}>
                <button type="button" className="hr-inst-row" onClick={() => (openId === i.id ? setOpenId(null) : openDetail(i.id))}>
                  <span className="hr-inst-name">{i.subject_name}</span>
                  <span className={`hr-badge hr-badge-${i.status}`}>{i.status}</span>
                  <span className="hr-progress"><span className="hr-progress-bar" style={{ width: `${pct}%` }} /></span>
                  <span className="hr-inst-count">{i.done}/{i.total}</span>
                </button>
                {openId === i.id && (
                  <div className="hr-inst-detail">
                    {detail === null ? <div className="hr-state">Loading…</div> : (
                      <>
                        <ul className="hr-items">
                          {detail.items.map((it) => (
                            <li key={it.id} className="hr-item">
                              <label className="hr-item-check">
                                <input type="checkbox" checked={it.done} disabled={!canEdit} onChange={() => toggle(it)} />
                                <span className={it.done ? 'hr-item-done' : ''}>{it.label}</span>
                              </label>
                              {it.description && <div className="hr-item-desc">{it.description}</div>}
                              {renderItemAction && renderItemAction(it, { subjectId: detail.instance.subject_user_node_id, instanceId: detail.instance.id, refresh })}
                            </li>
                          ))}
                        </ul>
                        {canEdit && detail.instance.status === 'open' && (
                          <button className="btn" onClick={complete}>Mark complete</button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
