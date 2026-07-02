// Shown when a public storefront endpoint reports the storefront is unavailable
// (unknown slug, disabled, or products/pos not enabled — all 404). Rendered as
// page content inside the shared BrandShell (supplied by StorefrontLayout), so
// the "unavailable" state still carries the tenant's branding.
export function NotAvailableCard() {
  return (
    <div className="storefront-unavailable">
      <h2>Online ordering isn’t available here</h2>
      <p>This storefront may be closed, or the link may be incorrect.</p>
    </div>
  );
}
