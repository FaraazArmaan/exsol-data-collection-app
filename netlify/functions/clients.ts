import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { requireAdmin, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { deriveSlug } from './_shared/identifier';

const CreateBody = z.object({
  name: z.string().min(1).max(200),
});

interface ClientRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export default async (req: Request, _ctx: Context) => {
  let actor;
  try {
    actor = await requireAdmin(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT id, name, slug, created_at
      FROM public.clients
      ORDER BY created_at DESC
    `) as ClientRow[];
    return jsonOk({ clients: rows });
  }

  if (req.method === 'POST') {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

    const baseSlug = deriveSlug(parsed.data.name);
    let slug = baseSlug;
    let suffix = 2;
    for (let i = 0; i < 25; i++) {
      const existing = (await sql`
        SELECT 1 FROM public.clients WHERE slug = ${slug} LIMIT 1
      `) as unknown[];
      if (existing.length === 0) break;
      slug = `${baseSlug}-${suffix++}`;
    }

    const inserted = (await sql`
      INSERT INTO public.clients (name, slug, created_by)
      VALUES (${parsed.data.name}, ${slug}, ${actor.admin.id})
      RETURNING id, created_at
    `) as { id: string; created_at: string }[];

    return jsonOk(
      { client: { id: inserted[0]!.id, name: parsed.data.name, slug, created_at: inserted[0]!.created_at } },
      { status: 201 },
    );
  }

  return jsonError(405, 'method_not_allowed');
};
