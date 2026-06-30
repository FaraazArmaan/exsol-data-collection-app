import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicApi, PosApiError } from '../api';
import { formatRupees, formatOrderNo } from '../lib/money';
import { StatusPill } from '../components/StatusPill';
import type { SaleStatus } from '../lib/fsm';
import { StorefrontShell, NotAvailableCard } from './StorefrontShell';

const TERMINAL = ['fulfilled', 'cancelled', 'refunded'];

// Customer receipt. Polls every 20s until a terminal status, so "Paid" /
// "Ready" appear without a refresh. The sale UUID is the bearer token. §6.8.
export default function StorefrontReceiptPage() {
  const { saleUuid } = useParams<{ saleUuid: string }>();
  const [sale, setSale] = useState<any>(null);
  const [error, setError] = useState<PosApiError | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchOnce() {
      try {
        const s = await publicApi.getSale(saleUuid!);
        if (cancelled) return;
        setSale(s);
        if (TERMINAL.includes(s.status)) stopRef.current = true;
      } catch (e) {
        if (cancelled) return;
        setError(e as PosApiError);
        stopRef.current = true;
      }
    }
    fetchOnce();
    const t = setInterval(() => { if (!stopRef.current) void fetchOnce(); }, 20_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [saleUuid]);

  if (error) return <StorefrontShell><NotAvailableCard /></StorefrontShell>;
  if (!sale) return <StorefrontShell>Loading…</StorefrontShell>;

  const t = sale.timeline ?? {};
  const strip = [
    t.placedAt && `Placed ${new Date(t.placedAt).toLocaleTimeString()}`,
    t.paidAt && `Paid ${new Date(t.paidAt).toLocaleTimeString()}`,
    t.fulfilledAt && `Ready ${new Date(t.fulfilledAt).toLocaleTimeString()}`,
    t.cancelledAt && `Cancelled ${new Date(t.cancelledAt).toLocaleTimeString()}`,
    t.refundedAt && `Refunded ${new Date(t.refundedAt).toLocaleTimeString()}`,
  ].filter(Boolean);

  return (
    <StorefrontShell tenantName="Your order">
      <div className="pos-drawer" style={{ position: 'static', width: 'auto', boxShadow: 'none' }}>
        <header>
          <h2>{formatOrderNo(sale.orderNo)} <StatusPill status={sale.status as SaleStatus} /></h2>
          <p>{strip.join(' · ')}</p>
        </header>
        <section>
          <h3>Items</h3>
          <ul>
            {sale.lines.map((l: any, i: number) => (
              <li key={i}>{l.productNameSnap} ×{l.qty} — {formatRupees(l.lineTotalCents)}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Total</h3>
          <div>{formatRupees(sale.totalCents)}</div>
        </section>
      </div>
    </StorefrontShell>
  );
}
