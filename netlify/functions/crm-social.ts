// GET/POST /api/crm/social — social/contact-provider connections (MOCK seam).
//   GET  → one card per provider with its connection status + import stats.
//   POST → { provider, action }:
//            connect    → mark connected with a mock account label
//            disconnect → mark disconnected
//            import     → (must be connected) mock-import a batch of contacts
//                         into crm_leads (source 'social'); returns { imported }.
// Real OAuth/keys are deferred — only src/modules/crm/lib/social-import changes.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';
import { SocialAction } from './_crm-validators';
import {
  SOCIAL_PROVIDERS, PROVIDER_LABELS, mockAccountLabel, mockImportContacts,
} from '../../src/modules/crm/lib/social-import';

export const config = { path: '/api/crm/social', method: ['GET', 'POST'] };

interface ConnRow {
  provider: string; status: string; account_label: string | null;
  imported_total: number; last_imported_at: string | null;
}

async function cards(sql: ReturnType<typeof db>, clientId: string) {
  const rows = (await sql`
    SELECT provider, status, account_label, imported_total, last_imported_at
    FROM public.crm_social_connections WHERE client_id = ${clientId}::uuid
  `) as ConnRow[];
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return SOCIAL_PROVIDERS.map((p) => {
    const c = byProvider.get(p);
    return {
      provider: p,
      label: PROVIDER_LABELS[p],
      status: c?.status ?? 'disconnected',
      account_label: c?.account_label ?? null,
      imported_total: c?.imported_total ?? 0,
      last_imported_at: c?.last_imported_at ?? null,
    };
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireCrm(req, ['crm.customers.view']);
    if (!a.ok) return a.res;
    return jsonOk({ providers: await cards(db(), a.ctx.clientId) });
  }

  if (req.method === 'POST') {
    const a = await requireCrm(req, ['crm.customers.edit']);
    if (!a.ok) return a.res;

    let body: SocialAction;
    try { body = SocialAction.parse(await req.json()); }
    catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }

    const sql = db();
    const { clientId, userNodeId } = a.ctx;

    if (body.action === 'connect') {
      await sql`
        INSERT INTO public.crm_social_connections (client_id, provider, status, account_label, connected_at, created_by_user_node, updated_at)
        VALUES (${clientId}::uuid, ${body.provider}, 'connected', ${mockAccountLabel(body.provider)}, now(), ${userNodeId}::uuid, now())
        ON CONFLICT (client_id, provider) DO UPDATE
          SET status = 'connected', account_label = EXCLUDED.account_label, connected_at = now(), updated_at = now()
      `;
      return jsonOk({ providers: await cards(sql, clientId) });
    }

    if (body.action === 'disconnect') {
      await sql`
        INSERT INTO public.crm_social_connections (client_id, provider, status, updated_at)
        VALUES (${clientId}::uuid, ${body.provider}, 'disconnected', now())
        ON CONFLICT (client_id, provider) DO UPDATE SET status = 'disconnected', updated_at = now()
      `;
      return jsonOk({ providers: await cards(sql, clientId) });
    }

    // import — must be connected
    const conn = (await sql`
      SELECT status, imported_total FROM public.crm_social_connections
      WHERE client_id = ${clientId}::uuid AND provider = ${body.provider} LIMIT 1
    `) as Array<{ status: string; imported_total: number }>;
    if (!conn[0] || conn[0].status !== 'connected') return jsonError(409, 'not_connected');

    const contacts = mockImportContacts(body.provider, conn[0].imported_total);
    for (const c of contacts) {
      await sql`
        INSERT INTO public.crm_leads (client_id, name, email, phone, message, source, status)
        VALUES (${clientId}::uuid, ${c.name}, ${c.email}, ${c.phone}, ${'Imported from ' + body.provider}, 'social', 'new')
      `;
    }
    await sql`
      UPDATE public.crm_social_connections
      SET imported_total = imported_total + ${contacts.length}, last_imported_at = now(), updated_at = now()
      WHERE client_id = ${clientId}::uuid AND provider = ${body.provider}
    `;
    return jsonOk({ imported: contacts.length, providers: await cards(sql, clientId) });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
