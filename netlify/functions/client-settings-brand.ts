// PATCH /api/client-settings/brand — authed partial brand update.
// Gated by _platform.settings.edit. Every supplied *_key / heroKeys element
// must belong to the acting tenant (cross-tenant guard). See branding spec §5.3.
import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { logAudit } from './_shared/audit';
import { isAllowedBrandKey, keyBelongsToClient } from './_shared/brand';
import { rejectCrossSiteMutation } from './_shared/csrf';

export const config = { path: '/api/client-settings/brand', method: 'PATCH' };

const HEX = /^#[0-9a-fA-F]{6}$/;
const keyField = z.string().refine(isAllowedBrandKey, 'invalid_key').nullable();

const Body = z.object({
  logoKey:     keyField.optional(),
  logoAltKey:  keyField.optional(),
  faviconKey:  keyField.optional(),
  appIconKey:  keyField.optional(),
  socialKey:   keyField.optional(),
  heroKeys:    z.array(z.string().refine(isAllowedBrandKey, 'invalid_key')).optional(),
  accent:      z.string().regex(HEX).nullable().optional(),
  theme:       z.enum(['dark', 'light']).optional(),
  fontHeading: z.string().max(80).nullable().optional(),
  fontBody:    z.string().max(80).nullable().optional(),
}).strict();

export default async (req: Request, _ctx?: Context) => {
  if (req.method !== 'PATCH') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;
  const auth = await authenticateForPermission(req, '_platform.settings.edit');
  if (auth instanceof Response) return auth;
  const scope = resolveClientIdOrRespond(auth, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  let parsed: z.infer<typeof Body>;
  try { parsed = Body.parse(await req.json()); }
  catch { return jsonError(400, 'validation_failed'); }

  // Cross-tenant guard: every supplied key must embed the acting client's uuid.
  const singleKeys: (keyof typeof parsed)[] = ['logoKey', 'logoAltKey', 'faviconKey', 'appIconKey', 'socialKey'];
  for (const f of singleKeys) {
    const v = parsed[f];
    if (typeof v === 'string' && !keyBelongsToClient(v, clientId)) return jsonError(400, 'forbidden_cross_tenant_key');
  }
  if (parsed.heroKeys) {
    for (const k of parsed.heroKeys) if (!keyBelongsToClient(k, clientId)) return jsonError(400, 'forbidden_cross_tenant_key');
  }

  const has = (k: keyof typeof parsed) => k in parsed && parsed[k] !== undefined;
  const changed = (['logoKey','logoAltKey','faviconKey','appIconKey','socialKey','heroKeys','accent','theme','fontHeading','fontBody'] as const)
    .filter(has);
  if (changed.length === 0) return jsonOk({ ok: true });

  const sql = db();
  // Single fully-parameterized UPDATE. Each column uses CASE WHEN <supplied>
  // THEN <value> ELSE <column> END so only supplied fields change and an
  // explicit null still clears (unlike COALESCE). Neon tagged-template binds
  // every value; identifiers are literal.
  await sql`
    UPDATE public.clients SET
      brand_logo_key      = CASE WHEN ${has('logoKey')}     THEN ${parsed.logoKey ?? null}      ELSE brand_logo_key END,
      brand_logo_alt_key  = CASE WHEN ${has('logoAltKey')}  THEN ${parsed.logoAltKey ?? null}   ELSE brand_logo_alt_key END,
      brand_favicon_key   = CASE WHEN ${has('faviconKey')}  THEN ${parsed.faviconKey ?? null}   ELSE brand_favicon_key END,
      brand_app_icon_key  = CASE WHEN ${has('appIconKey')}  THEN ${parsed.appIconKey ?? null}   ELSE brand_app_icon_key END,
      brand_social_key    = CASE WHEN ${has('socialKey')}   THEN ${parsed.socialKey ?? null}    ELSE brand_social_key END,
      brand_hero_keys     = CASE WHEN ${has('heroKeys')}    THEN ${parsed.heroKeys ?? null}::text[] ELSE brand_hero_keys END,
      brand_accent        = CASE WHEN ${has('accent')}      THEN ${parsed.accent ?? null}       ELSE brand_accent END,
      brand_theme         = CASE WHEN ${has('theme')}       THEN ${parsed.theme ?? null}        ELSE brand_theme END,
      brand_font_heading  = CASE WHEN ${has('fontHeading')} THEN ${parsed.fontHeading ?? null}  ELSE brand_font_heading END,
      brand_font_body     = CASE WHEN ${has('fontBody')}    THEN ${parsed.fontBody ?? null}     ELSE brand_font_body END
    WHERE id = ${clientId}::uuid
  `;

  await logAudit(sql, {
    session: auth, op: 'client.brand_updated', clientId,
    targetType: 'client', targetId: clientId,
    detail: { fields_changed: changed },
  });
  return jsonOk({ ok: true });
};
