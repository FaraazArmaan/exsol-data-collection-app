import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface MenuVariant { id: string; title: string; salePriceCents: number; }

export interface MenuProduct {
  id: string;
  name: string;
  categoryId: string | null;
  salePriceCents: number;
  thumbKey: string | null;
  // Bundle metadata — present only on storefront/catalog payloads (undefined for
  // the staff POS menu). Drives the tile's Bundle badge + sold-out state.
  isBundle?: boolean;
  bundleInStock?: boolean;
  bundleComponents?: { name: string; qty: number }[];
  variants?: MenuVariant[];
}

export interface CartLine {
  key: string;
  productId: string;
  variantId?: string;
  productNameSnap: string;
  variantNameSnap?: string;
  unitPriceCentsSnap: number;
  qty: number;
}

export interface CartState {
  lines: CartLine[];
  customer: { name: string; phone: string; email: string };
  channel: 'instore' | 'online' | 'pickup';
  idempotencyKey: string;

  addLine(p: MenuProduct, variant?: MenuVariant): void;
  setQty(key: string, qty: number): void;
  removeLine(key: string): void;
  setCustomer(patch: Partial<CartState['customer']>): void;
  setChannel(c: CartState['channel']): void;
  clear(): void;

  subtotalCents(): number;
  itemCount(): number;
  isValidForSubmit(): { ok: boolean; reason?: string };
}

const newKey = () => crypto.randomUUID();
const emptyCustomer = () => ({ name: '', phone: '', email: '' });

const GUEST_PREFIX = 'guest-';

// Shared store factory. `storage` is the Web Storage backend (local vs session);
// `defaultChannel` lets the guest storefront start on a valid public channel.
function makeCartStore(
  storageKey: string,
  storage: Storage,
  defaultChannel: CartState['channel'],
) {
  return create<CartState>()(
    persist(
      (set, get) => ({
        lines: [],
        customer: emptyCustomer(),
        channel: defaultChannel,
        idempotencyKey: newKey(),

        addLine(p, variant) {
          set((s) => {
            const key = `${p.id}:${variant?.id ?? 'base'}`;
            const existing = s.lines.find((l) => l.key === key);
            if (existing) {
              return {
                lines: s.lines.map((l) =>
                  l.key === key ? { ...l, qty: l.qty + 1 } : l,
                ),
              };
            }
            return {
              lines: [
                ...s.lines,
                {
                  key,
                  productId: p.id,
                  variantId: variant?.id,
                  productNameSnap: p.name,
                  variantNameSnap: variant?.title,
                  unitPriceCentsSnap: variant?.salePriceCents ?? p.salePriceCents,
                  qty: 1,
                },
              ],
            };
          });
        },
        setQty(key, qty) {
          const lineKey = get().lines.find((line) => line.key === key || (line.productId === key && !line.variantId))?.key ?? key;
          if (qty <= 0) {
            get().removeLine(lineKey);
            return;
          }
          set((s) => ({
            lines: s.lines.map((l) =>
              l.key === lineKey ? { ...l, qty } : l,
            ),
          }));
        },
        removeLine(key) {
          set((s) => ({ lines: s.lines.filter((l) => l.key !== key && !(l.productId === key && !l.variantId)) }));
        },
        setCustomer(patch) {
          set((s) => ({ customer: { ...s.customer, ...patch } }));
        },
        setChannel(c) {
          set({ channel: c });
        },
        clear() {
          set({
            lines: [],
            customer: emptyCustomer(),
            channel: defaultChannel,
            idempotencyKey: newKey(),
          });
        },

        subtotalCents() {
          return get().lines.reduce((a, l) => a + l.qty * l.unitPriceCentsSnap, 0);
        },
        itemCount() {
          return get().lines.reduce((a, l) => a + l.qty, 0);
        },
        isValidForSubmit() {
          const s = get();
          if (s.lines.length === 0) return { ok: false, reason: 'empty_cart' };
          if (!s.customer.name.trim()) return { ok: false, reason: 'name_required' };
          if (!s.customer.phone.trim()) return { ok: false, reason: 'phone_required' };
          if (
            s.customer.email &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.customer.email)
          ) {
            return { ok: false, reason: 'email_invalid' };
          }
          return { ok: true };
        },
      }),
      {
        name: storageKey,
        storage: createJSONStorage(() => storage),
        version: 2,
        migrate: (persisted) => {
          const state = persisted as Partial<CartState>;
          return {
            ...state,
            lines: (state.lines ?? []).map((line) => ({ ...line, key: line.key ?? `${line.productId}:${line.variantId ?? 'base'}` })),
          } as CartState;
        },
      },
    ),
  );
}

// Staff cart (localStorage, per bucket+user). A `guest-` prefixed userNodeId
// transparently routes to the guest store, so the v1 MenuPage/CartPage props
// stay identical — the only convention is the prefix. See spec §6.5.
export function createCartStore(bucketId: string, userNodeId: string) {
  if (userNodeId.startsWith(GUEST_PREFIX)) {
    return createGuestCartStore(bucketId, userNodeId.slice(GUEST_PREFIX.length));
  }
  return makeCartStore(`pos-cart:${bucketId}:${userNodeId}`, localStorage, 'instore');
}

// Guest storefront cart — sessionStorage (per-tab), defaults to a public
// channel. Keyed by (bucket-or-slug, session). See spec §6.2.
export function createGuestCartStore(bucketId: string, sessionId: string) {
  return makeCartStore(`pos-cart-guest:${bucketId}:${sessionId}`, sessionStorage, 'pickup');
}
