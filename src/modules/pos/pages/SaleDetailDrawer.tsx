import { useEffect, useState } from 'react';
import { posApi, PosApiError } from '../shared/api';
import { formatRupees, formatOrderNo } from '../lib/money';
import { StatusPill } from '../components/StatusPill';
import { SaleStateButtons } from '../components/SaleStateButtons';
import type { FsmAction } from '../lib/fsm';

export function SaleDetailDrawer(props: {
  saleId: string;
  perms: ReadonlySet<string>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sale, setSale] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    posApi.getSale(props.saleId)
      .then((s) => { if (!cancel) setSale(s); })
      .catch((e) => { if (!cancel) setErr(e instanceof PosApiError ? e.code : 'error'); });
    return () => { cancel = true; };
  }, [props.saleId]);

  async function doAction(a: FsmAction) {
    try {
      // The POST /state response is the authoritative just-written sale row.
      const updated = await posApi.transition(props.saleId, {
        action: a,
        ...(a === 'markPaid' ? { paymentMethod: 'cash' as const } : {}),
      });
      // Flip the status the instant the POST returns — don't gate the visible
      // update behind the (cold, slow) refetch. `updated` is spread last so it
      // always wins over the prior/stale row.
      setSale((s: any) => ({ ...s, ...updated }));
      props.onChanged();
      // Best-effort backfill of lines + audit; status is already correct above,
      // and an eventually-consistent/lagging read still can't override it.
      try {
        const detail = await posApi.getSale(props.saleId);
        setSale((s: any) => ({ ...detail, ...updated }));
      } catch { /* keep the optimistic row */ }
    } catch (e) {
      if (e instanceof PosApiError) setErr(e.code);
    }
  }

  if (err) {
    return (
      <aside role="dialog" className="pos-drawer">
        <button onClick={props.onClose} aria-label="Close">×</button>
        <p>Error: {err}</p>
      </aside>
    );
  }
  if (!sale) {
    return (
      <aside role="dialog" className="pos-drawer">
        Loading…
      </aside>
    );
  }

  return (
    <aside role="dialog" className="pos-drawer">
      <header>
        <button onClick={props.onClose} aria-label="Close">×</button>
        <h2>
          {formatOrderNo(sale.order_no)} <StatusPill status={sale.status} />
        </h2>
        <p>Channel: {sale.channel} · Created {new Date(sale.created_at).toLocaleString()}</p>
      </header>
      <section>
        <h3>Customer</h3>
        <p>
          {sale.customer_name} · {sale.customer_phone}
          {sale.customer_email ? <> · <a href={`mailto:${sale.customer_email}`}>{sale.customer_email}</a></> : null}
        </p>
      </section>
      <section>
        <h3>Lines</h3>
        <ul>
          {sale.lines.map((l: any) => (
            <li key={l.id}>{l.product_name_snap} ×{l.qty} — {formatRupees(Number(l.line_total_cents))}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Money</h3>
        <div>Subtotal {formatRupees(Number(sale.subtotal_cents))}</div>
        <div>Total {formatRupees(Number(sale.total_cents))}</div>
      </section>
      <section>
        <h3>Audit</h3>
        <ul>
          {sale.audit.map((a: any, i: number) => (
            <li key={i}>{a.op} — {new Date(a.occurred_at).toLocaleString()}</li>
          ))}
        </ul>
      </section>
      <SaleStateButtons
        status={sale.status}
        channel={sale.channel}
        perms={props.perms}
        onAction={doAction}
      />
    </aside>
  );
}
