import type { ReactNode } from 'react';

// Chromeless public layout: a branded tenant header, no sidebar, no auth
// context. Used by every storefront page. See spec §6.4.
export function StorefrontShell({ tenantName, children }: { tenantName?: string; children: ReactNode }) {
  return (
    <div className="storefront-shell">
      <header className="storefront-header">
        <span className="storefront-tenant">{tenantName ?? 'Online ordering'}</span>
      </header>
      <main className="storefront-main">{children}</main>
    </div>
  );
}

// Shown when any public endpoint reports the storefront is unavailable
// (unknown slug, disabled, or products/pos not enabled — all 404).
export function NotAvailableCard() {
  return (
    <div className="storefront-unavailable">
      <h2>Online ordering isn’t available here</h2>
      <p>This storefront may be closed, or the link may be incorrect.</p>
    </div>
  );
}
