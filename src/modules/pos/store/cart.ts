import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface MenuProduct {
  id: string;
  name: string;
  categoryId: string | null;
  salePriceCents: number;
  thumbKey: string | null;
}

export interface CartLine {
  productId: string;
  productNameSnap: string;
  unitPriceCentsSnap: number;
  qty: number;
}

export interface CartState {
  lines: CartLine[];
  customer: { name: string; phone: string; email: string };
  channel: 'instore' | 'online' | 'pickup';
  idempotencyKey: string;

  addLine(p: MenuProduct): void;
  setQty(productId: string, qty: number): void;
  removeLine(productId: string): void;
  setCustomer(patch: Partial<CartState['customer']>): void;
  setChannel(c: CartState['channel']): void;
  clear(): void;

  subtotalCents(): number;
  itemCount(): number;
  isValidForSubmit(): { ok: boolean; reason?: string };
}

const newKey = () => crypto.randomUUID();
const emptyCustomer = () => ({ name: '', phone: '', email: '' });

export function createCartStore(bucketId: string, userNodeId: string) {
  const storageKey = `pos-cart:${bucketId}:${userNodeId}`;
  return create<CartState>()(
    persist(
      (set, get) => ({
        lines: [],
        customer: emptyCustomer(),
        channel: 'instore',
        idempotencyKey: newKey(),

        addLine(p) {
          set((s) => {
            const existing = s.lines.find((l) => l.productId === p.id);
            if (existing) {
              return {
                lines: s.lines.map((l) =>
                  l.productId === p.id ? { ...l, qty: l.qty + 1 } : l,
                ),
              };
            }
            return {
              lines: [
                ...s.lines,
                {
                  productId: p.id,
                  productNameSnap: p.name,
                  unitPriceCentsSnap: p.salePriceCents,
                  qty: 1,
                },
              ],
            };
          });
        },
        setQty(productId, qty) {
          if (qty <= 0) {
            get().removeLine(productId);
            return;
          }
          set((s) => ({
            lines: s.lines.map((l) =>
              l.productId === productId ? { ...l, qty } : l,
            ),
          }));
        },
        removeLine(productId) {
          set((s) => ({ lines: s.lines.filter((l) => l.productId !== productId) }));
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
            channel: 'instore',
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
      { name: storageKey, storage: createJSONStorage(() => localStorage) },
    ),
  );
}
