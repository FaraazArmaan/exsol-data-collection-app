import { db } from './_shared/db';

interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
}

export async function ensureEmployeeProfileForUser(clientId: string, userNodeId: string): Promise<void> {
  const sql = db();
  const existing = await sql`
    SELECT id
    FROM public.workforce_employee_profiles
    WHERE client_id = ${clientId}::uuid
      AND user_node_id = ${userNodeId}::uuid
    LIMIT 1
  ` as Array<{ id: string }>;
  if (existing.length > 0) return;

  const users = await sql`
    SELECT id, display_name, email
    FROM public.user_nodes
    WHERE id = ${userNodeId}::uuid
      AND client_id = ${clientId}::uuid
    LIMIT 1
  ` as UserRow[];
  const user = users[0];
  if (!user) return;

  const legalName = user.display_name.trim() || user.email || 'Employee';
  const resources = await sql`
    INSERT INTO public.booking_resources (bucket_id, name)
    VALUES (${clientId}::uuid, ${legalName}::text)
    RETURNING id
  ` as Array<{ id: string }>;

  await sql`
    INSERT INTO public.workforce_employee_profiles (
      client_id, resource_id, user_node_id, legal_name, employment_status, employment_type, primary_email
    )
    VALUES (
      ${clientId}::uuid,
      ${resources[0]!.id}::uuid,
      ${user.id}::uuid,
      ${legalName}::text,
      'active',
      'full_time',
      ${user.email}::text
    )
  `;
}

export async function ensureEmployeeProfilesForTeam(clientId: string): Promise<void> {
  const sql = db();
  const users = await sql`
    SELECT un.id
    FROM public.user_nodes un
    LEFT JOIN public.workforce_employee_profiles p
      ON p.client_id = un.client_id AND p.user_node_id = un.id
    WHERE un.client_id = ${clientId}::uuid
      AND p.id IS NULL
    ORDER BY un.level_number NULLS LAST, un.display_name ASC
  ` as Array<{ id: string }>;

  for (const user of users) {
    await ensureEmployeeProfileForUser(clientId, user.id);
  }
}
