// GET  → { admins: [{ id, email, display_name, is_bootstrap, has_password, has_google, created_at }] }
// POST { email, display_name, password? }  → creates new admin (password optional;
//   if omitted, the new admin can only sign in via Google).
//
// Bootstrap status is set false for new admins. The first admin is set up by
// the migration / bootstrap script.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { hashPassword } from './_shared/argon';
import { AdminCapabilityError, requireAdmin, requireAdminCapability, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';

const CreateBody = z.object({
  email: z.string().email().max(254),
  display_name: z.string().min(1).max(200),
  password: z.string().min(8).max(200).optional(),
  role: z.enum(['owner', 'support', 'billing', 'read_only', 'security_admin']).optional(),
});

interface TeamRow {
  id: string;
  email: string;
  display_name: string;
  is_bootstrap: boolean;
  role: string;
  has_password: boolean;
  has_google: boolean;
  created_at: string;
}

export default async (req: Request, _ctx: Context) => {
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;

  let actor;
  try { actor = await requireAdmin(req); } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const sql = db();

  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT id, email, display_name, is_bootstrap, role,
             (password_hash IS NOT NULL) AS has_password,
             (google_sub IS NOT NULL) AS has_google,
             created_at
      FROM public.admins
      ORDER BY is_bootstrap DESC, created_at ASC
    `) as TeamRow[];
    return jsonOk({ admins: rows });
  }

  if (req.method === 'POST') {
    try { await requireAdminCapability(req, 'admin.manage'); } catch (e) {
      if (e instanceof AdminCapabilityError) return jsonError(403, 'admin_role_forbidden', { capability: e.capability });
      if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
      throw e;
    }
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

    const passwordHash = parsed.data.password ? await hashPassword(parsed.data.password) : null;

    try {
      const inserted = (await sql`
        INSERT INTO public.admins (email, display_name, password_hash, is_bootstrap, role, password_changed_at)
        VALUES (${parsed.data.email}, ${parsed.data.display_name}, ${passwordHash}, false, ${parsed.data.role ?? 'support'}, ${passwordHash ? new Date().toISOString() : null}::timestamptz)
        RETURNING id, email, display_name, is_bootstrap, role,
                  (password_hash IS NOT NULL) AS has_password,
                  (google_sub IS NOT NULL) AS has_google,
                  created_at
      `) as TeamRow[];
      await logAudit(sql, {
        session: { kind: 'admin', admin: { id: actor.admin.id, email: '' } },
        op: 'admin.created',
        clientId: null,
        targetType: 'admin',
        targetId: inserted[0]!.id,
        detail: { email: parsed.data.email, display_name: parsed.data.display_name, role: parsed.data.role ?? 'support' },
      });
      return jsonOk({ admin: inserted[0] }, { status: 201 });
    } catch (e: unknown) {
      // Neon surfaces unique-constraint failures as code 23505,
      // CHECK constraint violations (e.g. admins_has_at_least_one_credential
      // when password omitted and no google_sub yet bound) as 23514.
      const code = (e as { code?: string })?.code;
      if (code === '23505') return jsonError(409, 'email_taken');
      if (code === '23514') return jsonError(400, 'credential_required');
      throw e;
    }
  }

  return jsonError(405, 'method_not_allowed');
};
