import { useEffect, useState } from 'react';
import { PaymentsApiError, paymentsApi } from '../shared/api';
import type { PaymentsDashboard } from '../shared/types';
import PaymentProviderSettingsCard from './PaymentProviderSettingsCard';

export default function PaymentsDashboardPage({ canManageProvider }: { canManageProvider: boolean }) {
  const [dashboard, setDashboard] = useState<PaymentsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    paymentsApi.dashboard().then(setDashboard).catch((cause: unknown) => {
      setError(cause instanceof PaymentsApiError ? cause.code : 'dashboard_unavailable');
    });
  }, []);

  return (
    <div className="pay-shell">
      <header className="pay-header">
        <div>
          <p className="pay-eyebrow">Payments</p>
          <h1>Payments foundation</h1>
          <p className="pay-muted">
            This workspace is ready for the Payments module foundation. Online collection remains off
            until the ledger, provider verification, and reconciliation controls are complete.
          </p>
        </div>
      </header>

      {error ? <p className="pay-error">Could not load payment status: {error}.</p> : null}
      {!dashboard && !error ? <p className="pay-muted">Loading…</p> : null}
      {dashboard ? (
        <section className="pay-panel" aria-label="Payments release status">
          <h2>What comes next</h2>
          <p>{dashboard.message}</p>
          <ul className="pay-checklist">
            <li>Record authorized Booking cash receipts with immutable evidence.</li>
            <li>Add tenant-scoped Razorpay Test-mode configuration.</li>
            <li>Verify signed webhooks before changing a booking or sale payment state.</li>
          </ul>
        </section>
      ) : null}
      {canManageProvider ? <PaymentProviderSettingsCard /> : null}
    </div>
  );
}
