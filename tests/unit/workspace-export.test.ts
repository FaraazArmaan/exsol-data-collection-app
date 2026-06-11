import { describe, expect, test } from 'vitest';
import { PLATFORM_SURFACES } from '../../src/modules/registry/types';
import { OP_LABELS } from '../../src/modules/ams/components/audit/op-labels';

describe('workspace export — registry registration', () => {
  test('PLATFORM_SURFACES includes "workspace"', () => {
    expect((PLATFORM_SURFACES as readonly string[]).includes('workspace')).toBe(true);
  });

  test('OP_LABELS has a label for workspace.exported', () => {
    expect(OP_LABELS['workspace.exported']).toBe('Exported workspace data');
  });
});

import { collectWorkspaceSnapshot } from '../../netlify/functions/_shared/workspace-export-collect';
import { countTables } from '../../netlify/functions/_shared/workspace-export-types';
import type { ExportActor } from '../../netlify/functions/_shared/workspace-export-types';

// Mock sql tagged template. Routes by the leading FROM clause; returns the
// matching fixture array. Anything unrecognized → empty array (and the test
// will fail loudly because counts will be off).
function mockSqlWithFixtures(fixtures: Record<string, unknown[]>) {
  return ((strings: TemplateStringsArray) => {
    const joined = strings.join(' ').toLowerCase();
    // Match the FIRST `FROM public.<table>` clause, not any occurrence.
    // Subqueries inside the WHERE clause would otherwise false-positive on
    // the parent table (e.g. file_categories matching public.files).
    const m = joined.match(/from\s+public\.([a-z_]+)/);
    const primary = m?.[1];
    if (primary && fixtures[primary]) return Promise.resolve(fixtures[primary]);
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof collectWorkspaceSnapshot>[0];
}

const ACTOR: ExportActor = { kind: 'admin', id: 'admin-1', email: 'admin@x' };

describe('collectWorkspaceSnapshot — shape', () => {
  test('returns schema_version 1 and the supplied actor', async () => {
    const sql = mockSqlWithFixtures({
      clients: [{ id: 'c-1', slug: 's', name: 'N' }],
    });
    const snap = await collectWorkspaceSnapshot(sql, 'c-1', ACTOR);
    expect(snap.schema_version).toBe(1);
    expect(snap.exported_by).toEqual(ACTOR);
    expect(typeof snap.exported_at).toBe('string');
    expect(snap.client).toEqual({ id: 'c-1', slug: 's', name: 'N' });
  });

  test('counts match fixture sizes', async () => {
    const sql = mockSqlWithFixtures({
      clients: [{ id: 'c-1', slug: 's', name: 'N' }],
      client_levels: [{ level_number: 1 }, { level_number: 2 }, { level_number: 3 }],
      client_roles: Array.from({ length: 5 }, (_, i) => ({ id: `r-${i}` })),
      user_nodes: Array.from({ length: 12 }, (_, i) => ({ id: `n-${i}` })),
      files: Array.from({ length: 4 }, (_, i) => ({ id: `f-${i}` })),
      products: Array.from({ length: 2 }, (_, i) => ({ id: `p-${i}` })),
    });
    const snap = await collectWorkspaceSnapshot(sql, 'c-1', ACTOR);
    const c = countTables(snap);
    expect(c.levels).toBe(3);
    expect(c.roles).toBe(5);
    expect(c.user_nodes).toBe(12);
    expect(c.files).toBe(4);
    expect(c.products).toBe(2);
  });
});

describe('collectWorkspaceSnapshot — redactions', () => {
  test('credential rows omit password_hash, temp_password_plain, password_reset_requested_at', async () => {
    const sql = mockSqlWithFixtures({
      clients: [{ id: 'c-1' }],
      user_node_credentials: [
        {
          id: 'cred-1',
          email: 'a@x',
          must_change_password: false,
          last_login_at: '2026-06-11T00:00:00Z',
          // These three MUST NOT appear in the snapshot — but they're in the
          // fixture to prove SELECT-list omission strips them upstream of JS.
          // The collector uses a hand-written SELECT list, so even if the
          // mock returns these keys the collector should ignore them.
          password_hash: 'argon2:secret',
          temp_password_plain: 'temp-secret',
          password_reset_requested_at: '2026-06-10T00:00:00Z',
        },
      ],
    });
    const snap = await collectWorkspaceSnapshot(sql, 'c-1', ACTOR);
    expect(snap.credentials.length).toBe(1);
    const cred = snap.credentials[0]!;
    expect('password_hash' in cred).toBe(false);
    expect('temp_password_plain' in cred).toBe(false);
    expect('password_reset_requested_at' in cred).toBe(false);
    expect(cred.email).toBe('a@x');
  });

  test('guard: no redacted field name appears anywhere in stringified snapshot', async () => {
    const sql = mockSqlWithFixtures({
      clients: [{ id: 'c-1' }],
      user_node_credentials: [
        {
          id: 'cred-1', email: 'a@x', must_change_password: false,
          password_hash: 'argon2:secret', temp_password_plain: 'temp-secret',
          password_reset_requested_at: '2026-06-10T00:00:00Z',
        },
      ],
    });
    const snap = await collectWorkspaceSnapshot(sql, 'c-1', ACTOR);
    const text = JSON.stringify(snap);
    expect(text).not.toMatch(/password_hash/);
    expect(text).not.toMatch(/temp_password_plain/);
    expect(text).not.toMatch(/password_reset_requested_at/);
    expect(text).not.toMatch(/argon2:secret/);
    expect(text).not.toMatch(/temp-secret/);
  });
});
