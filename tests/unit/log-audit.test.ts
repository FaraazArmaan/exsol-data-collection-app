import { describe, expect, test, vi } from 'vitest';
import { logAudit } from '../../netlify/functions/_shared/audit';
import type { AnySession } from '../../netlify/functions/_shared/permissions';

const admin: AnySession = { kind: 'admin', admin: { id: 'admin-1', email: 'a@x' } };
const bu: AnySession = {
  kind: 'bucket_user', user_node_id: 'un-1', client_id: 'c-1', level_number: 1,
};
const impersonatedBu: AnySession = {
  kind: 'bucket_user',
  user_node_id: 'un-1',
  client_id: 'c-1',
  level_number: 1,
  impersonated_by_admin: 'admin-2',
};

function mockSql() {
  const calls: Array<{ strings: TemplateStringsArray; values: unknown[] }> = [];
  // sql is a tagged-template function. We capture invocations and return a fake promise.
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings, values });
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof logAudit>[0];
  return { fn, calls };
}

describe('logAudit', () => {
  test('admin session writes actor_admin and leaves actor_user_node null', async () => {
    const { fn, calls } = mockSql();
    await logAudit(fn, { session: admin, op: 'client.created', targetType: 'client', targetId: 'c-1' });
    expect(calls.length).toBe(1);
    // values[0] = actor_admin, values[1] = actor_user_node, values[2] = impersonated_by_admin
    expect(calls[0]!.values[0]).toBe('admin-1');
    expect(calls[0]!.values[1]).toBeNull();
    expect(calls[0]!.values[2]).toBeNull();
    expect(calls[0]!.values[3]).toBe('client.created');
  });

  test('bucket-user session writes actor_user_node and leaves actor_admin null', async () => {
    const { fn, calls } = mockSql();
    await logAudit(fn, { session: bu, op: 'user_node.created', targetType: 'user_node', targetId: 'un-2' });
    expect(calls[0]!.values[0]).toBeNull();
    expect(calls[0]!.values[1]).toBe('un-1');
  });

  test('impersonated bucket-user session writes impersonated_by_admin', async () => {
    const { fn, calls } = mockSql();
    await logAudit(fn, { session: impersonatedBu, op: 'user_node.created' });
    expect(calls[0]!.values[0]).toBeNull();
    expect(calls[0]!.values[1]).toBe('un-1');
    expect(calls[0]!.values[2]).toBe('admin-2');
  });

  test('SQL throwing does not propagate; helper resolves silently', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwingSql = (() => Promise.reject(new Error('connection lost'))) as unknown as Parameters<typeof logAudit>[0];
    await expect(logAudit(throwingSql, { session: admin, op: 'test.op' })).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith('[audit] insert failed', expect.objectContaining({ op: 'test.op' }));
    errSpy.mockRestore();
  });

  test('detail is JSON-stringified before insert; null when omitted', async () => {
    const { fn, calls } = mockSql();
    await logAudit(fn, { session: admin, op: 'x.y', detail: { foo: 'bar' } });
    expect(calls[0]!.values[7]).toBe(JSON.stringify({ foo: 'bar' }));
    await logAudit(fn, { session: admin, op: 'x.y' });
    expect(calls[1]!.values[7]).toBeNull();
  });
});
