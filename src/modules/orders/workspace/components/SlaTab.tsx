// SlaTab — SLA targets editor + stage-breach list (Task 5).
//
// Lets an owner/editor configure per-stage max_minutes targets, then shows
// which sales are currently breaching those limits.
import { useEffect, useState } from 'react';
import { ordersApi, OrdersApiError } from '../../shared/api';
import type { SlaTarget, SlaBreach, OrderStage } from '../../shared/types';
import { Button } from '../../../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState, PermissionState } from '../../../../components/ui/Feedback';

interface Props {
  perms: ReadonlySet<string>;
}

const ALL_STAGES: OrderStage[] = [
  'pending_payment', 'paid', 'fulfilled', 'cancelled', 'refunded',
  'picking', 'packing', 'shipped', 'delivered', 'backordered',
];

const STAGE_LABEL: Record<OrderStage, string> = {
  pending_payment: 'Pending Payment',
  paid: 'Paid',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  picking: 'Picking',
  packing: 'Packing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  backordered: 'Backordered',
};

function humanError(e: unknown): string {
  if (e instanceof OrdersApiError) {
    if (e.status === 412) return 'Orders module not enabled.';
    if (e.status === 403) return 'Permission denied.';
    if (e.status === 400) return `Invalid request: ${e.code}.`;
    return `Error: ${e.code}`;
  }
  return 'Network error — please try again.';
}

export default function SlaTab({ perms }: Props) {
  const canView = perms.has('orders.business.view');
  const canEdit = perms.has('orders.business.edit');

  // SLA breach data
  const [slaData, setSlaData] = useState<{ breaches: SlaBreach[]; breach_count: number } | null>(null);
  const [targets, setTargets] = useState<SlaTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Target editor state: stage → max_minutes string (empty = not set)
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  function loadData() {
    setLoading(true);
    Promise.all([ordersApi.getSla(), ordersApi.listSlaTargets()])
      .then(([sla, tgts]) => {
        setSlaData({ breaches: sla.breaches, breach_count: sla.breach_count });
        setTargets(tgts);
        // Prime editor with current values
        const init: Record<string, string> = {};
        for (const t of tgts) init[t.stage] = String(t.max_minutes);
        setEditing(init);
        setLoadError(null);
      })
      .catch((e) => setLoadError(humanError(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadData(); }, []);

  async function handleSaveTargets(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaveOk(false);

    const updated: SlaTarget[] = [];
    for (const stage of ALL_STAGES) {
      const raw = editing[stage];
      if (!raw || raw.trim() === '') continue;
      const mins = parseInt(raw, 10);
      if (isNaN(mins) || mins < 1) {
        setSaveError(`Invalid value for ${STAGE_LABEL[stage]}: must be a positive integer.`);
        return;
      }
      updated.push({ stage, max_minutes: mins });
    }

    if (updated.length === 0) {
      setSaveError('Enter at least one target.');
      return;
    }

    setSaving(true);
    try {
      const saved = await ordersApi.updateSlaTargets(updated);
      setTargets(saved);
      setSaveOk(true);
      // Refresh breach list after targets change
      loadData();
    } catch (err) {
      setSaveError(humanError(err));
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <div className="ord-shell">
        <PermissionState />
      </div>
    );
  }

  return (
    <div className="ord-shell">
      {/* SLA Targets Editor */}
      {canEdit && (
        <section className="ord-section">
          <h2 className="ord-section-title">SLA Targets</h2>
          <p className="ord-muted" style={{ marginBottom: 12 }}>
            Set maximum allowed minutes per stage. Leave a field blank to remove the target.
          </p>
          <form className="ord-form" onSubmit={handleSaveTargets}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 12 }}>
              {ALL_STAGES.map((stage) => (
                <div key={stage} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label className="ord-muted" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                    {STAGE_LABEL[stage]}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      className="ord-input"
                      type="number"
                      placeholder="minutes"
                      value={editing[stage] ?? ''}
                      onChange={(ev) => setEditing((prev) => ({ ...prev, [stage]: ev.target.value }))}
                      min={1}
                      style={{ width: 90 }}
                    />
                    <span className="ord-muted" style={{ fontSize: '0.75rem' }}>min</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="ord-btn ord-btn-primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save Targets'}
              </button>
              {saveOk && <span style={{ color: 'var(--success)', fontSize: '0.85rem' }}>Saved.</span>}
            </div>
            {saveError && <p className="ord-form-error">{saveError}</p>}
          </form>
        </section>
      )}

      {/* Read-only target summary for non-editors */}
      {!canEdit && targets.length > 0 && (
        <section className="ord-section">
          <h2 className="ord-section-title">SLA Targets</h2>
          <table className="ord-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th className="ord-num">Max (min)</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.stage}>
                  <td>{STAGE_LABEL[t.stage as OrderStage] ?? t.stage}</td>
                  <td className="ord-num">{t.max_minutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* SLA Breaches */}
      <section className="ord-section">
        <h2 className="ord-section-title">
          SLA Breaches
          {slaData && slaData.breach_count > 0 && (
            <span className="ord-badge ord-badge-queued" style={{ marginLeft: 8 }}>
              {slaData.breach_count}
            </span>
          )}
        </h2>

        {loading ? (
          <LoadingState title="Loading SLA data" />
        ) : loadError ? (
          <ErrorState title="SLA data could not load" action={<Button variant="secondary" onClick={loadData}>Try again</Button>}>{loadError}</ErrorState>
        ) : !slaData || slaData.breaches.length === 0 ? (
          <EmptyState title={targets.length === 0
            ? 'No SLA targets configured yet.'
            : 'No SLA breaches — all stages within target.'} />
        ) : (
          <table className="ord-table">
            <thead>
              <tr>
                <th className="ord-num">Order #</th>
                <th>Stage</th>
                <th className="ord-num">Actual (min)</th>
                <th className="ord-num">Target (min)</th>
                <th className="ord-num">Over by</th>
              </tr>
            </thead>
            <tbody>
              {slaData.breaches.map((b, i) => (
                <tr key={`${b.sale_id}-${b.stage}-${i}`}>
                  <td className="ord-num">{b.order_no}</td>
                  <td>{STAGE_LABEL[b.stage as OrderStage] ?? b.stage}</td>
                  <td className="ord-num">{Math.round(b.minutes)}</td>
                  <td className="ord-num">{b.max_minutes}</td>
                  <td className="ord-num" style={{ color: 'var(--danger)' }}>
                    +{Math.round(b.minutes - b.max_minutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
