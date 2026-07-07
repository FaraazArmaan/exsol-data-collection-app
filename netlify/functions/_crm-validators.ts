import { z } from 'zod';
import { SOCIAL_PROVIDERS } from '../../src/modules/crm/lib/social-import';

// Public lead form. Email/phone are optional individually but the handler
// requires at least one. honeypot is checked BEFORE zod (bots fill every field).
export const LeadSubmit = z.object({
  slug: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().max(1000).optional(),
});
export type LeadSubmit = z.infer<typeof LeadSubmit>;

export const LeadAction = z.object({ action: z.enum(['convert', 'archive']) });
export type LeadAction = z.infer<typeof LeadAction>;

export const LeadsQuery = z.object({
  status: z.enum(['new', 'converted', 'archived']).default('new'),
});
export type LeadsQuery = z.infer<typeof LeadsQuery>;

export const SocialAction = z.object({
  provider: z.enum(SOCIAL_PROVIDERS),
  action: z.enum(['connect', 'disconnect', 'import']),
});
export type SocialAction = z.infer<typeof SocialAction>;
