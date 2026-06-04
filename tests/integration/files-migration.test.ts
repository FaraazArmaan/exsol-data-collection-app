import { beforeAll, describe, expect, test } from 'vitest';
import { neon } from '@neondatabase/serverless';

let sql: ReturnType<typeof neon>;

beforeAll(() => {
  sql = neon(process.env.DATABASE_URL!);
});

describe('migration 030: files table', () => {
  test('files table exists', async () => {
    const rows = (await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'files'
    `) as { table_name: string }[];
    expect(rows).toHaveLength(1);
  });

  test('files has the expected columns', async () => {
    const rows = (await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'files'
      ORDER BY ordinal_position
    `) as { column_name: string; data_type: string; is_nullable: string }[];
    const names = rows.map((r) => r.column_name);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'client_id', 'type', 'storage_kind',
      'blob_key', 'external_url', 'external_provider',
      'title', 'description', 'filename', 'mime', 'byte_size', 'thumbnail_key',
      'tier', 'uploaded_by_user_node', 'uploaded_by_admin',
      'created_at', 'updated_at', 'deleted_at',
    ]));
  });

  test('storage_kind_consistent CHECK rejects blob_key + external_url both set', async () => {
    const clients = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (clients.length === 0) return;
    await expect(sql`
      INSERT INTO public.files (
        client_id, type, storage_kind, blob_key, external_url, title,
        uploaded_by_user_node
      )
      VALUES (
        ${clients[0]!.id}::uuid, 'document', 'blob', 'k', 'https://x', 'bad',
        (SELECT id FROM public.user_nodes WHERE client_id = ${clients[0]!.id}::uuid LIMIT 1)
      )
    `).rejects.toThrow(/files_storage_kind_consistent/);
  });

  test('uploader_consistent CHECK rejects both uploader fields set', async () => {
    const clients = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (clients.length === 0) return;
    const adminRows = (await sql`SELECT id FROM public.admins LIMIT 1`) as { id: string }[];
    if (adminRows.length === 0) return;
    const nodeRows = (await sql`
      SELECT id FROM public.user_nodes WHERE client_id = ${clients[0]!.id}::uuid LIMIT 1
    `) as { id: string }[];
    if (nodeRows.length === 0) return;
    await expect(sql`
      INSERT INTO public.files (
        client_id, type, storage_kind, blob_key, title,
        uploaded_by_user_node, uploaded_by_admin
      )
      VALUES (
        ${clients[0]!.id}::uuid, 'document', 'blob', 'k', 'bad',
        ${nodeRows[0]!.id}::uuid, ${adminRows[0]!.id}::uuid
      )
    `).rejects.toThrow(/files_uploader_consistent/);
  });
});

describe('migration 031: file_categories', () => {
  test('table exists with PK (file_id, category_key)', async () => {
    const cols = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'file_categories'
      ORDER BY ordinal_position
    `) as { column_name: string }[];
    expect(cols.map((c) => c.column_name)).toEqual(['file_id', 'category_key']);
  });

  test('CHECK constraint rejects unknown category key', async () => {
    const clients = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (clients.length === 0) return;
    const nodeRows = (await sql`
      SELECT id FROM public.user_nodes WHERE client_id = ${clients[0]!.id}::uuid LIMIT 1
    `) as { id: string }[];
    if (nodeRows.length === 0) return;
    const fileRows = (await sql`
      INSERT INTO public.files (client_id, type, storage_kind, blob_key, title, uploaded_by_user_node)
      VALUES (${clients[0]!.id}::uuid, 'document', 'blob', 'k-test', 't', ${nodeRows[0]!.id}::uuid)
      RETURNING id
    `) as { id: string }[];
    const fileId = fileRows[0]!.id;
    try {
      await expect(sql`
        INSERT INTO public.file_categories (file_id, category_key)
        VALUES (${fileId}::uuid, 'not_a_real_key')
      `).rejects.toThrow();
    } finally {
      await sql`DELETE FROM public.files WHERE id = ${fileId}::uuid`;
    }
  });

  test('all 11 TS categories pass the CHECK', async () => {
    const clients = (await sql`SELECT id FROM public.clients LIMIT 1`) as { id: string }[];
    if (clients.length === 0) return;
    const nodeRows = (await sql`
      SELECT id FROM public.user_nodes WHERE client_id = ${clients[0]!.id}::uuid LIMIT 1
    `) as { id: string }[];
    if (nodeRows.length === 0) return;
    const fileRows = (await sql`
      INSERT INTO public.files (client_id, type, storage_kind, blob_key, title, uploaded_by_user_node)
      VALUES (${clients[0]!.id}::uuid, 'document', 'blob', 'k-test-2', 't', ${nodeRows[0]!.id}::uuid)
      RETURNING id
    `) as { id: string }[];
    const fileId = fileRows[0]!.id;
    const { CATEGORY_KEYS } = await import('../../src/modules/files/shared/categories');
    try {
      for (const k of CATEGORY_KEYS) {
        await sql`INSERT INTO public.file_categories (file_id, category_key) VALUES (${fileId}::uuid, ${k})`;
      }
      const rows = (await sql`
        SELECT category_key FROM public.file_categories WHERE file_id = ${fileId}::uuid
      `) as { category_key: string }[];
      expect(rows).toHaveLength(11);
    } finally {
      await sql`DELETE FROM public.files WHERE id = ${fileId}::uuid`;
    }
  });
});
