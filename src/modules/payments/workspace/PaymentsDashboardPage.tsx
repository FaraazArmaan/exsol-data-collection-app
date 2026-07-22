import { useEffect, useState } from 'react';
import { PaymentsApiError, paymentsApi } from '../shared/api';
import type { PaymentsDashboard } from '../shared/types';
import PaymentProviderSettingsCard from './PaymentProviderSettingsCard';
import { Button } from '../../../components/ui/Button';
import { ErrorState, LoadingState } from '../../../components/ui/Feedback';

export default function PaymentsDashboardPage({ canManageProvider }: { canManageProvider: boolean }) {
  const [dashboard, setDashboard] = useState<PaymentsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadDashboard() {
    setError(null);
    setDashboard(null);
    paymentsApi.dashboard().then(setDashboard).catch((cause: unknown) => {
      setError(cause instanceof PaymentsApiError ? cause.code : 'dashboard_unavailable');
    });
  }
  useEffect(() => { loadDashboard(); }, []);

  return (
    <div className="page pay-shell">
      <header className="pay-header">
        <div>
          <p className="pay-eyebrow">Payments</p>
          <h1>Payments</h1>
          <p className="pay-muted">
            This workspace is ready for the Payments module foundation. Online collection remains off
            until the ledger, provider verification, and reconciliation controls are complete.
          </p>
        </div>
      </header>

      {error ? <ErrorState title="Could not load payment status." action={<Button size="compact" onClick={loadDashboard}>Try again</Button>}>{error}</ErrorState> : null}
      {!dashboard && !error ? <LoadingState title="Loading payment status…" /> : null}
      {dashboard ? (
        <>
          <section className="pay-priority" aria-label="Payments attention needed">
            <div><strong>Collection is safely disabled</strong><p>{dashboard.message}</p></div>
            <span className="pay-status">Provider verification required</span>
          </section>
          <section className="pay-capabilities" aria-label="Payments capability status">
            <div><strong>{dashboard.capabilities.cashReceipts ? 'Available' : 'Planned'}</strong><span>Cash receipts</span></div>
            <div><strong>{dashboard.capabilities.onlineCollection ? 'Available' : 'Protected'}</strong><span>Online collection</span></div>
            <div><strong>{dashboard.capabilities.reconciliation ? 'Available' : 'Pending'}</strong><span>Reconciliation</span></div>
            <div><strong>{dashboard.capabilities.refunds ? 'Available' : 'Pending'}</strong><span>Refunds</span></div>
          </section>
          <section className="pay-panel" aria-label="Payments release safeguards">
            <h2>Before collection can go live</h2>
            <ul className="pay-checklist">
              <li>Record authorized Booking cash receipts with immutable evidence.</li>
              <li>Add tenant-scoped Razorpay Test-mode configuration.</li>
              <li>Verify signed webhooks before changing a booking or sale payment state.</li>
            </ul>
          </section>
        </>
      ) : null}
      {canManageProvider ? <PaymentProviderSettingsCard /> : null}
    </div>
  );
}
