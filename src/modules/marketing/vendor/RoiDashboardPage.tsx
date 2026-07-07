import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { marketingApi, type RoiReport } from '../shared/api';
import { MarketingNav } from './MarketingNav';
import { formatMoney } from '../../../lib/currency';
import { dateTime } from '../format';
import '../marketing.css';

// Campaign ROI dashboard. Attribution is email-match within each campaign's
// window (see lib/attribution.ts). Money is rendered in the workspace default
// currency (INR) — client.base_currency is not yet exposed on the FE auth
// context (follow-up).
export function RoiDashboardPage({ slug }: { slug: string }) {
  const [report, setReport] = useState<RoiReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    marketingApi
      .roi()
      .then(setReport)
      .catch(() => setError('Could not load ROI. Try again shortly.'));
  }, []);

  const t = report?.totals;

  return (
    <div className="page">
      <h1 className="page-title">Campaign ROI</h1>
      <MarketingNav slug={slug} active="roi" />

      {error && <div className="error">{error}</div>}
      {!report && !error && <div className="muted">Loading…</div>}

      {report && !error && (
        <>
          <div className="mkt-roi-cards">
            <div className="mkt-roi-card">
              <span className="mkt-roi-card__label">Attributed revenue</span>
              <span className="mkt-roi-card__value">{formatMoney(t!.revenue_cents)}</span>
            </div>
            <div className="mkt-roi-card">
              <span className="mkt-roi-card__label">Sent campaigns</span>
              <span className="mkt-roi-card__value">{t!.campaigns}</span>
            </div>
            <div className="mkt-roi-card">
              <span className="mkt-roi-card__label">Attributed orders</span>
              <span className="mkt-roi-card__value">{t!.attributed_orders}</span>
            </div>
            <div className="mkt-roi-card">
              <span className="mkt-roi-card__label">Attributed bookings</span>
              <span className="mkt-roi-card__value">{t!.attributed_bookings}</span>
            </div>
          </div>

          {report.campaigns.length === 0 ? (
            <div className="pm-empty">No sent campaigns yet. Revenue appears here once a campaign is sent.</div>
          ) : (
            <table className="pm-table mkt-roi-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Sent</th>
                  <th className="mkt-num">Window</th>
                  <th className="mkt-num">Sends</th>
                  <th className="mkt-num">Orders</th>
                  <th className="mkt-num">Bookings</th>
                  <th className="mkt-num">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {report.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td><Link to={`/c/${slug}/marketing/${c.id}`}>{c.name}</Link></td>
                    <td>{c.sent_at ? dateTime(c.sent_at) : '—'}</td>
                    <td className="mkt-num">{c.window_days}d</td>
                    <td className="mkt-num">{c.sends}</td>
                    <td className="mkt-num">{c.attributed_orders}</td>
                    <td className="mkt-num">{c.attributed_bookings}</td>
                    <td className="mkt-num mkt-roi-revenue">{formatMoney(c.revenue_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
