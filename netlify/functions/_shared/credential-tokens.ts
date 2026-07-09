import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { NeonQueryFunction } from '@neondatabase/serverless';

type SQL = NeonQueryFunction<false, false>;

const TOKEN_BYTES = 32;
const TOKEN_TTL_HOURS = 24;

export interface CredentialTokenRow {
  id: string;
  purpose: 'invite' | 'reset';
  client_id: string;
  user_node_id: string;
  credential_id: string;
  email: string;
  expires_at: string;
  consumed_at: string | null;
  client_slug: string;
  client_name: string;
  display_name: string;
}

export function generateCredentialToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashCredentialToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createCredentialToken(sql: SQL, input: {
  clientId: string;
  userNodeId: string;
  credentialId: string;
  email: string;
  purpose: 'invite' | 'reset';
  createdByAdmin: string | null;
  createdByUserNode: string | null;
}): Promise<{ token: string; expiresAt: string }> {
  const token = generateCredentialToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
  await sql`
    INSERT INTO public.user_credential_tokens (
      token_hash, purpose, client_id, user_node_id, credential_id, email,
      created_by_admin, created_by_user_node, expires_at
    ) VALUES (
      ${hashCredentialToken(token)}, ${input.purpose}, ${input.clientId}::uuid,
      ${input.userNodeId}::uuid, ${input.credentialId}::uuid, ${input.email},
      ${input.createdByAdmin}::uuid, ${input.createdByUserNode}::uuid,
      ${expiresAt}::timestamptz
    )
  `;
  return { token, expiresAt };
}

export async function getCredentialToken(sql: SQL, token: string): Promise<CredentialTokenRow | null> {
  const rows = (await sql`
    SELECT t.id, t.purpose, t.client_id, t.user_node_id, t.credential_id,
           t.email, t.expires_at, t.consumed_at,
           c.slug AS client_slug, c.name AS client_name,
           n.display_name
    FROM public.user_credential_tokens t
    JOIN public.clients c ON c.id = t.client_id
    JOIN public.user_nodes n ON n.id = t.user_node_id
    WHERE t.token_hash = ${hashCredentialToken(token)}
    LIMIT 1
  `) as CredentialTokenRow[];
  return rows[0] ?? null;
}

export async function consumeCredentialToken(sql: SQL, token: string): Promise<CredentialTokenRow | null> {
  const rows = (await sql`
    UPDATE public.user_credential_tokens
    SET consumed_at = now()
    WHERE token_hash = ${hashCredentialToken(token)}
      AND consumed_at IS NULL
      AND expires_at > now()
    RETURNING id, purpose, client_id, user_node_id, credential_id, email,
              expires_at, consumed_at
  `) as Array<Omit<CredentialTokenRow, 'client_slug' | 'client_name' | 'display_name'>>;
  const row = rows[0];
  if (!row) return null;
  const labels = (await sql`
    SELECT c.slug AS client_slug, c.name AS client_name, n.display_name
    FROM public.clients c
    JOIN public.user_nodes n ON n.client_id = c.id
    WHERE c.id = ${row.client_id}::uuid
      AND n.id = ${row.user_node_id}::uuid
    LIMIT 1
  `) as Pick<CredentialTokenRow, 'client_slug' | 'client_name' | 'display_name'>[];
  const label = labels[0]!;
  return { ...row, ...label };
}

export function placeholderPassword(): string {
  return `token-placeholder-${randomUUID()}`;
}
