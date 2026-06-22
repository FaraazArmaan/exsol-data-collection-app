import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { posApi } from '../api';
import { formatRupees, formatOrderNo } from '../lib/money';
import { StatusPill } from '../components/StatusPill';
import { SaleDetailDrawer } from './SaleDetailDrawer';

export interface SalesListPageProps {
  perms: ReadonlySet<string>;
  slug: string;
}

export default function SalesListPage(props: SalesListPageProps) {
  const [params] = useSearchParams();
  const { id: routeId } = useParams<{ id?: string }>();
  const openId = routeId ?? params.get('sale');
  const nav = useNavigate();

  const [data, setData] = useState<any>(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of ['status', 'channel', 'cashier', 'from', 'to', 'q']) {
      const v = params.get(k);
      if (v) p.set(k, v);
    }
    return p.toString();
  }, [params]);

  function reload() {
    posApi.getSales(queryString).then(setData);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  if (!data) return <div>Loading…</div>;

  return (
    <div className="pos-sales-list">
      <header>
        <h1>Sale History</h1>
        <Link to={`/c/${props.slug}/pos/menu`}>+ New Sale</Link>
      </header>
      <div className="pos-summary">
        <div>Sales: {data.summary.count}</div>
        <div>Revenue: {formatRupees(Number(data.summary.revenueCents))}</div>
        <div>Pending: {data.summary.pendingCount}</div>
        <div>Pickup queue: {data.summary.pickupQueueCount}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Order #</th><th>Time</th><th>Customer</th><th>Items</th>
            <th>Channel</th><th>Status</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
          {data.sales.map((s: any) => (
            <tr key={s.id} onClick={() => nav(`/c/${props.slug}/pos/sales/${s.id}`)} style={{ cursor: 'pointer' }}>
              <td>{formatOrderNo(s.order_no)}</td>
              <td>{new Date(s.created_at).toLocaleTimeString()}</td>
              <td>{s.customer_name} · {s.customer_phone}</td>
              <td>{s.line_count}</td>
              <td>{s.channel}</td>
              <td><StatusPill status={s.status} /></td>
              <td>{formatRupees(Number(s.total_cents))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {openId ? (
        <SaleDetailDrawer
          saleId={openId}
          perms={props.perms}
          onClose={() => nav(`/c/${props.slug}/pos/sales`)}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}
