import { z } from 'zod';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

// Shared query schema for analytics-* endpoints. `format` is consumed only by
// the export endpoint; list/dashboard endpoints ignore it.
export const AnalyticsQuery = z.object({
  from: isoDay,
  to: isoDay,
  compare: z.enum(['prior_period', 'prior_year', 'none']).default('none'),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  node: z.string().uuid().optional(),
  client: z.string().uuid().optional(),
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;
