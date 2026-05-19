import { pool, type DbClient } from './db.ts';

export type TenantCtx = {
  userId: string;
  workspaceId: string;
};

export type AdminCtx = {
  userId: string;
};

export async function withTenantContext<T>(
  ctx: TenantCtx,
  fn: (c: DbClient) => Promise<T>,
): Promise<T> {
  const client = (await pool().connect()) as unknown as DbClient;
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_user_id', $1, true),
              set_config('app.current_workspace_id', $2, true),
              set_config('app.is_admin', 'false', true)`,
      [ctx.userId, ctx.workspaceId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function withAdminContext<T>(
  ctx: AdminCtx,
  fn: (c: DbClient) => Promise<T>,
): Promise<T> {
  const client = (await pool().connect()) as unknown as DbClient;
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_user_id', $1, true),
              set_config('app.current_workspace_id', '', true),
              set_config('app.is_admin', 'true', true)`,
      [ctx.userId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function withUserContext<T>(
  ctx: { userId: string },
  fn: (c: DbClient) => Promise<T>,
): Promise<T> {
  const client = (await pool().connect()) as unknown as DbClient;
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_user_id', $1, true),
              set_config('app.current_workspace_id', '', true),
              set_config('app.is_admin', 'false', true)`,
      [ctx.userId],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
