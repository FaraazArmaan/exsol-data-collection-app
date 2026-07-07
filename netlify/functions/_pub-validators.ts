// Zod schema for the public storefront sale submission. Tighter bounds than the
// staff SaleCreateBody (kept separate so v1 test expectations are undisturbed),
// plus a honeypot field that must be empty. channel excludes 'instore' — guests
// can only place online/pickup orders. See spec §7.3.

import { z } from 'zod';

export const PublicSaleCreateBody = z.object({
  slug: z.string().min(1).max(120),
  channel: z.enum(['online', 'pickup']),
  idempotencyKey: z.string().min(8).max(64),
  honeypot: z.string().max(0), // empty-string only (defensive; also checked pre-parse)
  customer: z.object({
    name: z.string().refine((s) => s.trim().length > 0).pipe(z.string().max(120)),
    phone: z.string().refine((s) => s.trim().length > 0).pipe(z.string().max(20)),
    email: z.string().email().max(254).optional(),
  }),
  lines: z
    .array(z.object({
      productId: z.string().uuid(),
      qty: z.number().int().positive().max(99),
    }))
    .min(1)
    .max(50),
  couponCode: z.string().trim().min(1).max(40).optional(),
});

export type PublicSaleCreateBody = z.infer<typeof PublicSaleCreateBody>;
