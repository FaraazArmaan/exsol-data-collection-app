import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {
  assertCanWrite,
  isL1Owner,
  visibleFilesClauseValues,
  type FilesAccessSession,
} from '../../netlify/functions/_shared/files-access';

type SQL = NeonQueryFunction<false, false>;

let sql: SQL;

beforeAll(() => {
  sql = neon(process.env.DATABASE_URL!);
});

describe('isL1Owner', () => {
  test('true for level_number === 1', () => {
    expect(isL1Owner({ kind: 'bucket_user', user_node_id: 'u', client_id: 'c', level_number: 1 } as FilesAccessSession)).toBe(true);
  });
  test('false for level_number > 1', () => {
    expect(isL1Owner({ kind: 'bucket_user', user_node_id: 'u', client_id: 'c', level_number: 2 } as FilesAccessSession)).toBe(false);
  });
  test('false for admin session', () => {
    expect(isL1Owner({ kind: 'admin', admin: { id: 'a', email: '' } } as FilesAccessSession)).toBe(false);
  });
});

describe('assertCanWrite', () => {
  test('admin always allowed', async () => {
    await expect(
      assertCanWrite(sql, { kind: 'admin', admin: { id: 'a', email: '' } }),
    ).resolves.toBeUndefined();
  });

  test('L1 workspace user allowed regardless of bucket_family', async () => {
    await expect(
      assertCanWrite(sql, {
        kind: 'bucket_user', user_node_id: '00000000-0000-0000-0000-000000000000',
        client_id: '00000000-0000-0000-0000-000000000000', level_number: 1,
      }),
    ).resolves.toBeUndefined();
  });

  // L2+ bucket user denial covered via the permission-boundary test in Task 14
  // (requires a seeded fixture with a real bucket_family role row).
});

describe('visibleFilesClauseValues', () => {
  test('returns "public-only" hint for L2+ with no role/audience match', async () => {
    const out = visibleFilesClauseValues({
      kind: 'bucket_user',
      user_node_id: '00000000-0000-0000-0000-000000000001',
      client_id: '00000000-0000-0000-0000-000000000002',
      level_number: 2,
    });
    expect(out.userNodeId).toBe('00000000-0000-0000-0000-000000000001');
    expect(out.skipClause).toBe(false);
  });

  test('skipClause is true for L1 owner', async () => {
    const out = visibleFilesClauseValues({
      kind: 'bucket_user',
      user_node_id: '00000000-0000-0000-0000-000000000001',
      client_id: '00000000-0000-0000-0000-000000000002',
      level_number: 1,
    });
    expect(out.skipClause).toBe(true);
  });

  test('skipClause is true for admin', async () => {
    const out = visibleFilesClauseValues({ kind: 'admin', admin: { id: 'a', email: '' } });
    expect(out.skipClause).toBe(true);
  });
});
