import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import { createInvite, listInvites } from '../../src/lib/invite-manager.ts';
import { sendInviteEmail } from '../../src/lib/email-sender.ts';
import { json, methodNotAllowed, readJson } from '../../src/lib/http.ts';
import { opt } from '../../src/lib/env.ts';
import { withUserContext } from '../../src/lib/tenancy.ts';
import type { WorkspaceRole } from '../../src/lib/types.ts';

export const config = { path: '/api/workspaces/:wsid/invites' };

/**
 * /api/workspaces/:wsid/invites
 *   GET  — list invites for this workspace
 *   POST — create one, attempt email send via Resend, return fallback
 *          link if RESEND_API_KEY is unset or send fails.
 */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    return await handle(req, context);
  } catch (err) {
    console.error('[workspace-invites] uncaught', err);
    return json({ error: 'server_error', detail: (err as Error)?.message ?? String(err) }, 500);
  }
};

async function handle(req: Request, context: Context): Promise<Response> {
  const workspaceId = context.params?.wsid;
  if (!workspaceId) return json({ error: 'missing_workspace_id' }, 400);

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor, user } = resolved;

  if (req.method === 'GET') {
    if (!can(actor, 'team:read', { type: 'workspace', workspaceId })) {
      return json({ error: 'forbidden' }, 403);
    }
    const invites = await listInvites(workspaceId, actor.realActorId);
    return json({ invites });
  }

  if (req.method === 'POST') {
    if (!can(actor, 'team:invite', { type: 'workspace', workspaceId })) {
      return json({ error: 'forbidden' }, 403);
    }

    const body = await readJson<{ email?: string; role?: WorkspaceRole }>(req);
    if (!body?.email || !body.role) {
      return json({ error: 'invalid_input', detail: 'email and role required' }, 400);
    }

    const created = await createInvite({
      workspaceId,
      email: body.email,
      role: body.role,
      invitedBy: actor.realActorId,
    });

    if ('error' in created) {
      return json(created, 400);
    }

    const baseUrl = opt('APP_BASE_URL') ?? new URL(req.url).origin;
    const link = `${baseUrl.replace(/\/$/, '')}/invite-accept.html?token=${encodeURIComponent(created.token)}`;

    // Workspace + inviter names for the email body
    const meta = await withUserContext({ userId: actor.realActorId }, async (c) => {
      const w = await c.query(`SELECT name FROM workspaces WHERE id = $1`, [workspaceId]);
      return {
        workspaceName: w.rows[0]?.name ?? 'your workspace',
        inviterName: user.name ?? user.email,
      };
    });

    const sendResult = await sendInviteEmail({
      to: created.invite.email,
      inviteLink: link,
      workspaceName: meta.workspaceName,
      inviterName: meta.inviterName,
      role: created.invite.role,
    });

    return json({
      invite: created.invite,
      email: sendResult,
      // Always include the link so the UI can show "copy link" UX.
      // When sent succeeds, this is just for convenience.
      link,
    });
  }

  return methodNotAllowed();
}
