import { describe, expect, it } from 'vitest';
import workspaceLayoutsHandler from '../../netlify/functions/workspace-layouts';
import { makeBucketUserRequest, seedClientWithProductsEnabled, seedSubordinateUser } from '../pos/_helpers';

const LAYOUT = {
  version: 1 as const,
  tabs: ['services', 'calendar'],
  blocks: [{ id: 'entries', size: 'wide' as const }],
};
const PATH = '/api/workspace-layouts?namespace=booking.tabs';

describe('workspace layouts — tenant and owner safeguards', () => {
  it('saves an L1 default and returns it only to that workspace', async () => {
    const ownerA = await seedClientWithProductsEnabled();
    const ownerB = await seedClientWithProductsEnabled();
    const save = await workspaceLayoutsHandler(makeBucketUserRequest(ownerA, 'PUT', PATH, { scope: 'default', layout: LAYOUT }));
    expect(save.status).toBe(200);

    const current = await workspaceLayoutsHandler(makeBucketUserRequest(ownerA, 'GET', PATH));
    expect(current.status).toBe(200);
    const currentBody = await current.json() as { default_layout: unknown; personal_layout: unknown; is_owner: boolean };
    expect(currentBody.default_layout).toEqual(LAYOUT);
    expect(currentBody.personal_layout).toBeNull();
    expect(currentBody.is_owner).toBe(true);

    const otherWorkspace = await workspaceLayoutsHandler(makeBucketUserRequest(ownerB, 'GET', PATH));
    const otherBody = await otherWorkspace.json() as { default_layout: unknown };
    expect(otherBody.default_layout).toBeNull();
  });

  it('allows personal ordering for a subordinate but rejects an owner default', async () => {
    const owner = await seedClientWithProductsEnabled();
    const subordinate = await seedSubordinateUser(owner, 2);
    const personal = await workspaceLayoutsHandler(makeBucketUserRequest(subordinate, 'PUT', PATH, { scope: 'personal', layout: LAYOUT }));
    expect(personal.status).toBe(200);

    const denied = await workspaceLayoutsHandler(makeBucketUserRequest(subordinate, 'PUT', PATH, { scope: 'default', layout: LAYOUT }));
    expect(denied.status).toBe(403);
    expect((await denied.json() as { error: { code: string } }).error.code).toBe('owner_required');
  });

  it('rejects a cross-site mutation before changing a layout', async () => {
    const owner = await seedClientWithProductsEnabled();
    const res = await workspaceLayoutsHandler(new Request(`http://localhost${PATH}`, {
      method: 'PUT',
      headers: { cookie: owner.cookie, origin: 'https://evil.example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'personal', layout: LAYOUT }),
    }));
    expect(res.status).toBe(403);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('csrf_origin_mismatch');
  });
});
