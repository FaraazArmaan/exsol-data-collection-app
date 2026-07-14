import { useEffect, useMemo, useState } from 'react';
import { crmApi, type RepeatCart } from '../shared/api';
import { money } from '../format';
import { publicStorefrontUrl } from '../../pos/lib/storefront-path';

interface Props {
  customerId: string;
  slug: string;
  onClose: () => void;
}

// One-click B2B reorder: shows the products a customer usually buys with a
// suggested quantity (avg per past order). Staff adjust quantities, copy the
// order list into POS, or open the storefront for the customer to self-serve.
// (Auto-populating the storefront cart from the link is a documented follow-up.)
export function RepeatCartModal({ customerId, slug, onClose }: Props) {
  const [cart, setCart] = useState<RepeatCart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    crmApi.repeatCart(customerId)
      .then((c) => {
        if (!alive) return;
        setCart(c);
        setQtys(Object.fromEntries(c.items.filter((i) => i.available).map((i) => [i.product_id, i.qty])));
      })
      .catch(() => { if (alive) setError('Could not build a reorder.'); });
    return () => { alive = false; };
  }, [customerId]);

  const availableItems = cart?.items.filter((i) => i.available) ?? [];
  const total = useMemo(
    () => availableItems.reduce((sum, i) => sum + (qtys[i.product_id] ?? 0) * i.unit_price_cents, 0),
    [availableItems, qtys],
  );

  function setQty(pid: string, qty: number) {
    setQtys((q) => ({ ...q, [pid]: Math.max(0, qty) }));
    setCopied(false);
  }

  async function copyList() {
    const lines = availableItems
      .filter((i) => (qtys[i.product_id] ?? 0) > 0)
      .map((i) => `${qtys[i.product_id]}× ${i.name} — ${money(i.unit_price_cents)}`);
    if (lines.length === 0) return;
    const text = `Reorder for ${cart?.customer_name}\n${lines.join('\n')}\nTotal: ${money(total)}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* clipboard blocked */ }
  }

  const storefrontUrl = publicStorefrontUrl(slug, window.location.origin);

  return (
    <div className="crm-modal-backdrop" role="dialog" aria-modal="true" aria-label="Repeat order">
      <div className="crm-modal">
        <div className="crm-modal-header">Repeat order{cart ? ` · ${cart.customer_name}` : ''}</div>
        <div className="crm-modal-body">
          {error && <div className="error">{error}</div>}
          {!cart && !error && <div className="muted">Building reorder…</div>}

          {cart && cart.items.length === 0 && (
            <div className="muted">No purchase history to reorder from yet.</div>
          )}

          {cart && cart.items.length > 0 && (
            <>
              <table className="crm-repeat-table">
                <thead>
                  <tr><th>Product</th><th className="crm-num">Price</th><th className="crm-num">Qty</th></tr>
                </thead>
                <tbody>
                  {cart.items.map((i) => (
                    <tr key={i.product_id} className={i.available ? '' : 'crm-repeat-unavail'}>
                      <td>
                        {i.name}
                        <span className="crm-repeat-times"> · bought {i.times_bought}×</span>
                        {!i.available && <span className="crm-badge crm-badge-archived">unavailable</span>}
                      </td>
                      <td className="crm-num">{money(i.unit_price_cents)}</td>
                      <td className="crm-num">
                        {i.available ? (
                          <input
                            type="number" min="0" className="crm-repeat-qty"
                            value={qtys[i.product_id] ?? 0}
                            onChange={(e) => setQty(i.product_id, Math.floor(Number(e.target.value) || 0))}
                          />
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="crm-repeat-total">Total: <strong>{money(total)}</strong></div>
            </>
          )}
        </div>
        <div className="crm-modal-footer">
          <button className="btn" onClick={onClose}>Close</button>
          {cart && cart.items.length > 0 && (
            <>
              <a className="btn" href={storefrontUrl} target="_blank" rel="noreferrer">Open storefront ↗</a>
              <button className="btn btn-primary" onClick={copyList} disabled={total === 0}>
                {copied ? 'Copied ✓' : 'Copy order list'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
