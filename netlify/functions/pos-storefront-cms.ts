// /api/pos/storefront-cms — staff storefront content editor (GET + PUT).
//
// Mirrors brand-site.ts. Gated on pos.sale.refund (manager tier) with L1 bypass.
// sections is a validated hero + banners object; published gates public render.

import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requirePos } from './_pos-authz';
import { z } from 'zod';

export const config = { path: '/api/pos/storefront-cms' };

// A CTA link is rendered into a public <a href>. Allow ONLY absolute http(s) or
// a site-relative path — reject javascript:/data:/protocol-relative to prevent
// stored XSS from a hostile or compromised editor.
function isSafeHref(v: string): boolean {
  if (v === '') return true;
  if (/^https?:\/\//i.test(v)) return true;
  return v.startsWith('/') && !v.startsWith('//');
}

const Sections = z
  .object({
    hero: z
      .object({
        enabled: z.boolean(),
        heading: z.string().max(120),
        subheading: z.string().max(240),
        ctaLabel: z.string().max(40),
        ctaHref: z.string().max(300).refine(isSafeHref, 'unsafe_href'),
      })
      .partial({ subheading: true, ctaLabel: true, ctaHref: true })
      .optional(),
    banners: z.array(z.object({ text: z.string().min(1).max(200) })).max(5).optional(),
  })
  .strict();

const PutBody = z.object({
  sections: Sections,
  published: z.boolean(),
});

export default async function handler(req: Request): Promise<Response> {
  const a = await requirePos(req, ['pos.sale.refund']);
  if (!a.ok) return a.res;
  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT sections, published FROM public.storefront_cms WHERE client_id = ${a.ctx.clientId}::uuid
    `) as Array<{ sections: unknown; published: boolean }>;
    return jsonOk({ sections: rows[0]?.sections ?? {}, published: rows[0]?.published ?? false });
  }

  if (req.method === 'PUT') {
    let body: z.infer<typeof PutBody>;
    try {
      body = PutBody.parse(await req.json());
    } catch (e: any) {
      return jsonError(400, 'invalid_body', { issues: e?.issues });
    }
    await sql`
      INSERT INTO public.storefront_cms (client_id, sections, published)
      VALUES (${a.ctx.clientId}::uuid, ${JSON.stringify(body.sections)}::jsonb, ${body.published})
      ON CONFLICT (client_id) DO UPDATE SET
        sections = EXCLUDED.sections,
        published = EXCLUDED.published
    `;
    return jsonOk({ ok: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
