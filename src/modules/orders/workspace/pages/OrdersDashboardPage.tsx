import { useCallback, useEffect, useState } from 'react';
import '../../orders.css';
import { ordersApi, OrdersApiError } from '../../shared/api';
import type { OrdersDashboardData, StatusRow, ChannelRow } from '../../shared/types';
import { formatMoney } from '../../../../lib/currency';
import { Button } from '../../../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../../../components/ui/Feedback';
import RefundsShipmentsTab from '../components/RefundsShipmentsTab';
import BackordersTab from '../components/BackordersTab';
import SlaTab from '../components/SlaTab';
import FulfillmentsTab from '../components/FulfillmentsTab';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Pending Payment',
  paid: 'Paid',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const CHANNEL_LABEL: Record<string, string> = {
  instore: 'In-store',
  online: 'Online',
  pickup: 'Pickup',
};

function humanError(e: unknown): string {
  if (e instanceof OrdersApiError) {
    if (e.status === 412) return 'The Orders module is not enabled for this workspace.';
    if (e.status === 403) return 'You don\'t have permission to view orders.';
    return `Something went wrong (${e.code}).`;
  }
  return 'Network error — please try again.';
}

function formatFulfilTime(secs: number): string {
  if (secs <= 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type TabId = 'overview' | 'refunds-shipments' | 'backorders' | 'sla' | 'fulfillments';

export default function OrdersDashboardPage({ perms }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [data, setData] = useState<OrdersDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    ordersApi
      .dashboard()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => {
        setError(humanError(e));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="ord-shell">
      <div className="ord-header">
        <div>
          <h1 className="ord-title">Order Management</h1>
          <p className="ord-muted">Sales pipeline overview</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="ord-tabs" role="tablist">
        <button
          className={`ord-tab${activeTab === 'overview' ? ' ord-tab-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'overview'}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`ord-tab${activeTab === 'refunds-shipments' ? ' ord-tab-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'refunds-shipments'}
          onClick={() => setActiveTab('refunds-shipments')}
        >
          Returns &amp; Shipments
        </button>
        <button
          className={`ord-tab${activeTab === 'backorders' ? ' ord-tab-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'backorders'}
          onClick={() => setActiveTab('backorders')}
        >
          Backorders
        </button>
        <button
          className={`ord-tab${activeTab === 'sla' ? ' ord-tab-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'sla'}
          onClick={() => setActiveTab('sla')}
        >
          SLA
        </button>
        <button
          className={`ord-tab${activeTab === 'fulfillments' ? ' ord-tab-active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'fulfillments'}
          onClick={() => setActiveTab('fulfillments')}
        >
          Fulfillments
        </button>
      </div>

      {activeTab === 'refunds-shipments' && (
        <RefundsShipmentsTab perms={perms} />
      )}

      {activeTab === 'backorders' && (
        <BackordersTab perms={perms} />
      )}

      {activeTab === 'sla' && (
        <SlaTab perms={perms} />
      )}

      {activeTab === 'fulfillments' && (
        <FulfillmentsTab perms={perms} />
      )}

      {activeTab === 'overview' && loading && <LoadingState title="Loading orders overview" />}

      {activeTab === 'overview' && !loading && error && (
        <ErrorState title="Orders could not load" action={<Button variant="secondary" onClick={load}>Try again</Button>}>{error}</ErrorState>
      )}

      {activeTab === 'overview' && !loading && !error && data && (
        <>
          {/* KPI cards */}
          <div className="ord-kpi-row">
            <div className="ord-kpi-card">
              <div className="ord-kpi-label">Open Orders</div>
              <div className="ord-kpi-value">{data.open.n}</div>
            </div>
            <div className="ord-kpi-card">
              <div className="ord-kpi-label">Open Value</div>
              <div className="ord-kpi-value">
                {formatMoney(data.open.cents, data.base_currency)}
              </div>
            </div>
            <div className="ord-kpi-card">
              <div className="ord-kpi-label">Avg Fulfilment</div>
              <div className="ord-kpi-value">{formatFulfilTime(data.avg_fulfil_secs)}</div>
            </div>
            <div className="ord-kpi-card">
              <div className="ord-kpi-label">Backorders</div>
              <div className="ord-kpi-value">{data.backorders_active}</div>
            </div>
            <div className="ord-kpi-card">
              <div className="ord-kpi-label">SLA Breaches</div>
              <div
                className="ord-kpi-value"
                style={data.sla_breaches > 0 ? { color: 'var(--danger)' } : undefined}
              >
                {data.sla_breaches}
              </div>
            </div>
          </div>

          {(data.backorders_active > 0 || data.sla_breaches > 0) && (
            <section className="ord-priority" aria-label="Orders needing attention">
              <div>
                <h2 className="ord-section-title">Needs attention</h2>
                <p className="ord-muted">Resolve fulfilment and service commitments before reviewing the full ledger.</p>
              </div>
              <div className="ord-priority__actions">
                {data.backorders_active > 0 && (
                  <Button variant="secondary" onClick={() => setActiveTab('backorders')}>
                    Review {data.backorders_active} backorder{data.backorders_active === 1 ? '' : 's'}
                  </Button>
                )}
                {data.sla_breaches > 0 && (
                  <Button variant="danger" onClick={() => setActiveTab('sla')}>
                    Review {data.sla_breaches} SLA risk{data.sla_breaches === 1 ? '' : 's'}
                  </Button>
                )}
              </div>
            </section>
          )}

          {/* By status */}
          <section className="ord-section">
            <h2 className="ord-section-title">By Status</h2>
            {data.by_status.length === 0 ? (
              <EmptyState title="No sales recorded yet." />
            ) : (
              <table className="ord-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th className="ord-num">Orders</th>
                    <th className="ord-num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_status.map((r: StatusRow) => (
                    <tr key={r.status}>
                      <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                      <td className="ord-num">{r.n}</td>
                      <td className="ord-num">{formatMoney(r.cents, data.base_currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* By channel */}
          <section className="ord-section">
            <h2 className="ord-section-title">By Channel</h2>
            {data.by_channel.length === 0 ? (
              <EmptyState title="No sales recorded yet." />
            ) : (
              <table className="ord-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th className="ord-num">Orders</th>
                    <th className="ord-num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_channel.map((r: ChannelRow) => (
                    <tr key={r.channel}>
                      <td>{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
                      <td className="ord-num">{r.n}</td>
                      <td className="ord-num">{formatMoney(r.cents, data.base_currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
