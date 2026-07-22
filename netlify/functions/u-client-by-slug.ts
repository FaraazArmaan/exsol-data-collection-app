// Public endpoint — used by the login page to verify the slug exists.
// Returns minimal info; no auth required.

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const slug = new URL(req.url).searchParams.get('slug');
  if (!slug) return jsonError(400, 'validation_failed', 'slug required');

  const sql = db();
  const rows = (await sql`
    SELECT id, slug, name, timezone FROM public.clients WHERE slug = ${slug} LIMIT 1
  `) as { id: string; slug: string; name: string; timezone: string }[];
  const client = rows[0];
  if (!client) return jsonError(404, 'not_found');
  return jsonOk({ client });
};
