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

import { toJsonResponse, isoFilenameStamp } from '../../netlify/functions/_shared/workspace-export-format';

const SNAPSHOT_FIXTURE = {
  schema_version: 1 as const,
  exported_at: '2026-06-11T10:00:00.000Z',
  exported_by: { kind: 'admin' as const, id: 'a-1', email: 'a@x' },
  client: { id: 'c-1', slug: 'acme', name: 'Acme' },
  enabled_products: ['products'],
  levels: [], roles: [], cardinality_rules: [], user_nodes: [], credentials: [],
  files: { files: [], categories: [], allowed_nodes: [], allowed_roles: [], allowed_users: [] },
  products: { products: [], categories: [], images: [] },
};

describe('isoFilenameStamp', () => {
  test('formats Date as YYYYMMDDTHHMMSSZ', () => {
    expect(isoFilenameStamp(new Date('2026-06-11T10:23:45.678Z'))).toBe('20260611T102345Z');
  });
});

describe('toJsonResponse', () => {
  test('returns 200 with application/json and the right filename', async () => {
    const res = toJsonResponse(SNAPSHOT_FIXTURE, 'acme');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/attachment/);
    expect(cd).toMatch(/filename="workspace-acme-\d{8}T\d{6}Z\.json"/);
  });

  test('body parses back to a snapshot with schema_version 1', async () => {
    const res = toJsonResponse(SNAPSHOT_FIXTURE, 'acme');
    const text = await res.text();
    const parsed = JSON.parse(text);
    expect(parsed.schema_version).toBe(1);
    expect(parsed.client.slug).toBe('acme');
  });
});

import { toZipResponse, rowsToCsv } from '../../netlify/functions/_shared/workspace-export-format';
import { ExportTooLargeError } from '../../netlify/functions/_shared/exporters/types';
import JSZipForTest from 'jszip';

describe('rowsToCsv', () => {
  test('empty rows → empty string', () => {
    expect(rowsToCsv([])).toBe('');
  });

  test('basic rows with header row', () => {
    const out = rowsToCsv([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
    expect(out.split('\n')[0]).toBe('a,b');
    expect(out.split('\n')[1]).toBe('1,x');
  });

  test('embedded commas and quotes get RFC-4180 escaped', () => {
    const out = rowsToCsv([{ s: 'a,b' }, { s: 'he said "hi"' }]);
    const lines = out.split('\n');
    expect(lines[1]).toBe('"a,b"');
    expect(lines[2]).toBe('"he said ""hi"""');
  });

  test('jsonb / object values become JSON-encoded strings', () => {
    const out = rowsToCsv([{ id: 'x', fields: { a: 1 } }]);
    expect(out).toContain('"{""a"":1}"');
  });

  test('null values become empty cells', () => {
    const out = rowsToCsv([{ a: null, b: 'x' }]);
    expect(out.split('\n')[1]).toBe(',x');
  });
});

describe('toZipResponse', () => {
  test('returns 200 application/zip with attachment filename', async () => {
    const res = await toZipResponse(SNAPSHOT_FIXTURE, 'acme');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/zip/);
    expect(res.headers.get('content-disposition')).toMatch(/filename="workspace-acme-\d{8}T\d{6}Z\.zip"/);
  });

  test('archive contains the expected file list', async () => {
    const res = await toZipResponse(SNAPSHOT_FIXTURE, 'acme');
    const buf = Buffer.from(await res.arrayBuffer());
    const z = await JSZipForTest.loadAsync(buf);
    const names = Object.keys(z.files).sort();
    expect(names).toEqual([
      'README.txt',
      '_manifest.json',
      'client.csv',
      'client_cardinality_rules.csv',
      'client_levels.csv',
      'client_roles.csv',
      'enabled_products.csv',
      'files/file_allowed_nodes.csv',
      'files/file_allowed_roles.csv',
      'files/file_allowed_users.csv',
      'files/file_categories.csv',
      'files/files.csv',
      'products/product_categories.csv',
      'products/product_images.csv',
      'products/products.csv',
      'user_node_credentials.csv',
      'user_nodes.csv',
    ]);
  });

  test('_manifest.json contains schema_version and table_counts', async () => {
    const res = await toZipResponse(SNAPSHOT_FIXTURE, 'acme');
    const buf = Buffer.from(await res.arrayBuffer());
    const z = await JSZipForTest.loadAsync(buf);
    const manifest = JSON.parse(await z.file('_manifest.json')!.async('string'));
    expect(manifest.schema_version).toBe(1);
    expect(manifest.client_id).toBe('c-1');
    expect(manifest.slug).toBe('acme');
    expect(manifest.table_counts.user_nodes).toBe(0);
  });
});

describe('toZipResponse — 413 path', () => {
  test('throws ExportTooLargeError when archive exceeds MAX_BYTES', async () => {
    // Build a snapshot whose ZIP byte count we can force over the cap via
    // a single user_nodes row containing a huge string. After DEFLATE this
    // typically still compresses; to be reliable, fill it with random-ish
    // content the compressor can't crunch.
    const bigJunk = Array.from({ length: 8_000_000 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const fatSnapshot = {
      ...SNAPSHOT_FIXTURE,
      user_nodes: [{ id: 'n-1', display_name: 'x', payload: bigJunk }],
    };
    await expect(toZipResponse(fatSnapshot, 'acme')).rejects.toBeInstanceOf(ExportTooLargeError);
  }, 20_000);
});
