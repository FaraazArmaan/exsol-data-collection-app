import { useEffect, useState } from 'react';
import { posApi, PosApiError, type Coupon, type CouponCreateInput } from '../shared/api';
import { EcommerceNav } from './EcommerceNav';
import { formatRupees } from '../lib/money';

// Staff coupon manager (mounted at /c/:slug/pos/coupons). Generates storefront
// promo codes and lists their live redemption counts. Gated server-side by
// requirePos(['pos.sale.refund']) — the RouteMount mirrors that with the same key.

const EMPTY: CouponForm = {
  code: '', discountType: 'percent', discountValue: '10',
  minOrderCents: '', maxRedemptions: '', perCustomerLimit: '', expiresAt: '',
};

interface CouponForm {
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: string;
  minOrderCents: string;
  maxRedemptions: string;
  perCustomerLimit: string;
  expiresAt: string;
}

// Rupees (from the ₹ input) → integer paise for the money columns.
function rupeesToCents(v: string): number | undefined {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? undefined : Math.round(n * 100);
}
function intOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? null : Math.trunc(n);
}

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [form, setForm] = useState<CouponForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await posApi.listCoupons();
      setCoupons(r.coupons);
    } catch (e) {
      setError(e instanceof PosApiError ? e.code : 'network_error');
    }
  }
  useEffect(() => { void load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: CouponCreateInput = {
        code: form.code.trim(),
        discountType: form.discountType,
        discountValue:
          form.discountType === 'fixed'
            ? (rupeesToCents(form.discountValue) ?? 0)
            : Math.trunc(Number(form.discountValue)),
        minOrderCents: rupeesToCents(form.minOrderCents) ?? 0,
        maxRedemptions: intOrNull(form.maxRedemptions),
        perCustomerLimit: intOrNull(form.perCustomerLimit),
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      };
      await posApi.createCoupon(body);
      setForm(EMPTY);
      await load();
    } catch (e) {
      setError(e instanceof PosApiError ? e.code : 'network_error');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: Coupon) {
    try {
      await posApi.patchCoupon(c.id, { active: !c.active });
      await load();
    } catch (e) {
      setError(e instanceof PosApiError ? e.code : 'network_error');
    }
  }

  async function remove(c: Coupon) {
    try {
      await posApi.deleteCoupon(c.id);
      await load();
    } catch (e) {
      // A redeemed coupon can't be deleted — surface the reason instead of failing silently.
      setError(e instanceof PosApiError ? e.code : 'network_error');
    }
  }

  return (
    <div className="pos-coupons">
      <EcommerceNav active="coupons" />
      <header className="pos-coupons__header">
        <h1>Coupons</h1>
        <p className="muted">Storefront promo codes, validated at checkout.</p>
      </header>

      <form className="pos-coupons__form" onSubmit={create}>
        <div className="pos-coupons__grid">
          <label>Code
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SUMMER10" required />
          </label>
          <label>Type
            <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as 'percent' | 'fixed' })}>
              <option value="percent">Percent %</option>
              <option value="fixed">Fixed ₹</option>
            </select>
          </label>
          <label>{form.discountType === 'percent' ? 'Percent (1–100)' : 'Amount off (₹)'}
            <input value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} inputMode="decimal" required />
          </label>
          <label>Min order (₹)
            <input value={form.minOrderCents} onChange={(e) => setForm({ ...form, minOrderCents: e.target.value })} inputMode="decimal" placeholder="0" />
          </label>
          <label>Max uses
            <input value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })} inputMode="numeric" placeholder="∞" />
          </label>
          <label>Per customer
            <input value={form.perCustomerLimit} onChange={(e) => setForm({ ...form, perCustomerLimit: e.target.value })} inputMode="numeric" placeholder="∞" />
          </label>
          <label>Expires
            <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          </label>
        </div>
        {error && <div className="err">Error: {error}</div>}
        <button className="pos-side-cart__checkout" type="submit" disabled={saving || form.code.trim() === ''}>
          {saving ? 'Creating…' : 'Create coupon'}
        </button>
      </form>

      <div className="pos-coupons__list">
        {coupons === null ? (
          <p className="pos-loading">Loading…</p>
        ) : coupons.length === 0 ? (
          <p className="muted">No coupons yet.</p>
        ) : (
          coupons.map((c) => (
            <div key={c.id} className={`pos-coupons__item${c.active ? '' : ' is-inactive'}`}>
              <div className="pos-coupons__code">
                <strong>{c.code}</strong>
                <span className="pos-coupons__disc">
                  {c.discountType === 'percent' ? `${c.discountValue}% off` : `${formatRupees(c.discountValue)} off`}
                </span>
              </div>
              <div className="pos-coupons__meta">
                {c.minOrderCents > 0 && <span>min {formatRupees(c.minOrderCents)}</span>}
                <span>{c.redeemedCount}{c.maxRedemptions != null ? `/${c.maxRedemptions}` : ''} used</span>
                {c.expiresAt && <span>exp {c.expiresAt.slice(0, 10)}</span>}
              </div>
              <div className="pos-coupons__actions">
                <button type="button" onClick={() => toggle(c)}>{c.active ? 'Deactivate' : 'Activate'}</button>
                <button type="button" className="pos-coupons__del" onClick={() => remove(c)}>Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
