// Per-tab guest session id for the public storefront. Lives in sessionStorage
// so each tab is its own checkout session and closing the tab discards it —
// matching standard ecommerce expectations. Doubles as the sale idempotency
// key. See spec §6.1.

const KEY = 'pos-storefront-session';

export function getOrCreateStorefrontSession(): string {
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
  }
  return id;
}
