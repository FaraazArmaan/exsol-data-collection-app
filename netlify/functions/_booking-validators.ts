import { z } from 'zod';

const Uuid = z.string().uuid();
const NonBlank = z.string().refine((s) => s.trim().length > 0, 'must not be blank');
const Hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'HH:mm');
const OpenWindow = z.object({ open: Hhmm, close: Hhmm });
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WeeklySchedule = z.record(z.enum(WEEKDAYS), z.array(OpenWindow));
const PaymentMode = z.enum(['pay_at_venue', 'deposit', 'full_upfront']);

export const SettingsPut = z.object({
  slot_interval_min: z.number().int().min(5).max(240),
  lead_time_min: z.number().int().min(0).default(0),
  cancel_cutoff_min: z.number().int().min(0).default(0),
  weekly_schedule: WeeklySchedule.default({}),
  date_overrides: z.array(z.object({ date: z.string(), closed: z.boolean().optional() })).default([]),
});
export type SettingsPut = z.infer<typeof SettingsPut>;

export const ServiceCreate = z.object({
  name: NonBlank,
  duration_min: z.number().int().positive(),
  price_cents: z.number().int().min(0),
  payment_mode: PaymentMode.default('pay_at_venue'),
  deposit_cents: z.number().int().min(0).optional(),
  buffer_min: z.number().int().min(0).default(0),
  eligible_resource_ids: z.array(Uuid).default([]),
}).refine((s) => s.payment_mode !== 'deposit' || s.deposit_cents != null, {
  message: 'deposit_cents required when payment_mode is deposit', path: ['deposit_cents'],
});
export type ServiceCreate = z.infer<typeof ServiceCreate>;

// Patch fields carry NO defaults — an omitted key must leave the column unchanged
// (handler COALESCEs undefined→null→keep). The deposit invariant is re-checked in the handler.
export const ServicePatch = z.object({
  name: NonBlank.optional(),
  duration_min: z.number().int().positive().optional(),
  price_cents: z.number().int().min(0).optional(),
  payment_mode: PaymentMode.optional(),
  deposit_cents: z.number().int().min(0).nullable().optional(),
  buffer_min: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
  eligible_resource_ids: z.array(Uuid).optional(),
});
export type ServicePatch = z.infer<typeof ServicePatch>;

export const ResourceCreate = z.object({
  name: NonBlank,
  weekly_schedule: WeeklySchedule.default({}),
  active: z.boolean().default(true),
});
export type ResourceCreate = z.infer<typeof ResourceCreate>;

export const ResourcePatch = z.object({
  name: NonBlank.optional(),
  weekly_schedule: WeeklySchedule.optional(),
  active: z.boolean().optional(),
});
export type ResourcePatch = z.infer<typeof ResourcePatch>;

export const TimeOffCreate = z.object({
  resource_id: Uuid,
  starts_at: z.string(),
  ends_at: z.string(),
  reason: z.string().max(500).optional(),
});
export type TimeOffCreate = z.infer<typeof TimeOffCreate>;

// Vendor manual create: a normal booking (service + customer) OR a blocked staff-time
// window (blocked:true, needs end, no service/customer). Handler enforces the mode rules.
export const ManualCreateBody = z.object({
  blocked: z.boolean().optional(),
  service_id: Uuid.optional(),
  resource_id: Uuid,
  start: z.string(),
  end: z.string().optional(),
  customer: z.object({ name: NonBlank, phone: NonBlank, email: z.string().email().optional() }).optional(),
  mark_paid: z.boolean().optional(),
});
export type ManualCreateBody = z.infer<typeof ManualCreateBody>;

export const PublicCreateBody = z.object({
  service_id: Uuid,
  resource_id: z.union([Uuid, z.literal('any')]),
  start: z.string(), // ISO UTC instant
  customer: z.object({ name: NonBlank, phone: NonBlank, email: z.string().email().optional() }),
});
export type PublicCreateBody = z.infer<typeof PublicCreateBody>;
