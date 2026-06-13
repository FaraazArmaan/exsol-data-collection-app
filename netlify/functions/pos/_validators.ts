import { z } from 'zod';

const Uuid = z.string().uuid();
const Channel = z.enum(['instore', 'online', 'pickup']);
const Status = z.enum(['pending_payment', 'paid', 'fulfilled', 'cancelled', 'refunded']);
const NonBlank = z.string().refine((s) => s.trim().length > 0, 'must not be blank');

export const SaleCreateBody = z.object({
  channel: Channel,
  idempotencyKey: z.string().min(8).max(64),
  customer: z.object({
    name: NonBlank,
    phone: NonBlank,
    email: z.string().email().optional(),
  }),
  lines: z
    .array(
      z.object({
        productId: Uuid,
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
});
export type SaleCreateBody = z.infer<typeof SaleCreateBody>;

export const SaleStateBody = z.object({
  action: z.enum(['markPaid', 'fulfill', 'cancel', 'refund']),
  paymentMethod: z.enum(['cash']).optional(),
  reason: z.string().max(500).optional(),
});
export type SaleStateBody = z.infer<typeof SaleStateBody>;

const csv = <T extends z.ZodEnum<[string, ...string[]]>>(e: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? (v.split(',') as Array<z.infer<T>>) : undefined))
    .pipe(z.array(e).optional());

const todayIso = () => new Date().toISOString().slice(0, 10);

export const SalesListQuery = z.object({
  status: csv(Status),
  channel: csv(Channel),
  cashier: Uuid.optional(),
  from: z
    .string()
    .optional()
    .transform((v) => v ?? todayIso()),
  to: z
    .string()
    .optional()
    .transform((v) => v ?? todayIso()),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type SalesListQuery = z.infer<typeof SalesListQuery>;
