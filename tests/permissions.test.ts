import { describe, it, expect } from 'vitest';
import { can } from '../src/lib/permissions.ts';
import type { Action, ActorContext, Resource } from '../src/lib/types.ts';

const wsA = '00000000-0000-0000-0000-00000000000a';
const wsB = '00000000-0000-0000-0000-00000000000b';
const adminId = '00000000-0000-0000-0000-000000000ad1';
const userId = '00000000-0000-0000-0000-0000000000a1';

const admin = (workspaceId: string | null = null): ActorContext => ({
  realActorId: adminId,
  realRole: 'admin',
  onBehalfOfId: null,
  workspaceRole: null,
  workspaceId,
  isImpersonating: false,
  impersonationReason: null,
});

const primary = (ws = wsA): ActorContext => ({
  realActorId: userId,
  realRole: null,
  onBehalfOfId: null,
  workspaceRole: 'primary',
  workspaceId: ws,
  isImpersonating: false,
  impersonationReason: null,
});

const manager = (ws = wsA): ActorContext => ({
  realActorId: userId,
  realRole: null,
  onBehalfOfId: null,
  workspaceRole: 'manager',
  workspaceId: ws,
  isImpersonating: false,
  impersonationReason: null,
});

const storekeeper = (ws = wsA): ActorContext => ({
  realActorId: userId,
  realRole: null,
  onBehalfOfId: null,
  workspaceRole: 'storekeeper',
  workspaceId: ws,
  isImpersonating: false,
  impersonationReason: null,
});

const inWs = (workspaceId: string, type: Resource['type'] = 'product'): Resource => ({
  type,
  workspaceId,
});

const sys: Resource = { type: 'system' };

describe('permissionPolicy.can — admin', () => {
  it('admin can do every workspace action', () => {
    const actions: Action[] = [
      'product:read',
      'product:create',
      'product:update',
      'product:delete',
      'product:bulk_import',
      'stock:write',
      'export:create',
      'backup:run',
      'file:delete',
      'team:invite',
      'workspace:rotate_key',
      'workspace:edit_settings',
    ];
    for (const a of actions) {
      expect(can(admin(wsA), a, inWs(wsA)), a).toBe(true);
    }
  });

  it('admin can do admin-only actions', () => {
    const actions: Action[] = [
      'admin:onboard_client',
      'admin:disable_client',
      'admin:delete_client',
      'admin:unlock_workspace',
      'admin:impersonate',
      'admin:run_system_backup',
      'admin:view_all',
    ];
    for (const a of actions) {
      expect(can(admin(), a, sys), a).toBe(true);
    }
  });

  it('admin cannot act in a workspace different from their current context', () => {
    expect(can(admin(wsA), 'product:read', inWs(wsB))).toBe(false);
  });
});

describe('permissionPolicy.can — primary', () => {
  it('can read/create/update/delete products in their workspace', () => {
    expect(can(primary(), 'product:read', inWs(wsA))).toBe(true);
    expect(can(primary(), 'product:create', inWs(wsA))).toBe(true);
    expect(can(primary(), 'product:update', inWs(wsA))).toBe(true);
    expect(can(primary(), 'product:delete', inWs(wsA))).toBe(true);
  });

  it('cannot delete the workspace itself (admin-only)', () => {
    expect(can(primary(), 'workspace:delete', inWs(wsA))).toBe(false);
  });

  it('cannot act in another workspace', () => {
    expect(can(primary(wsA), 'product:read', inWs(wsB))).toBe(false);
    expect(can(primary(wsA), 'product:update', inWs(wsB))).toBe(false);
  });

  it('cannot use any admin-only action', () => {
    expect(can(primary(), 'admin:onboard_client', sys)).toBe(false);
    expect(can(primary(), 'admin:impersonate', sys)).toBe(false);
    expect(can(primary(), 'admin:run_system_backup', sys)).toBe(false);
  });

  it('can invite team members and rotate access key', () => {
    expect(can(primary(), 'team:invite', inWs(wsA))).toBe(true);
    expect(can(primary(), 'workspace:rotate_key', inWs(wsA))).toBe(true);
  });

  it('can run a backup', () => {
    expect(can(primary(), 'backup:run', inWs(wsA))).toBe(true);
  });
});

describe('permissionPolicy.can — manager', () => {
  it('can read/create/update products but not delete', () => {
    expect(can(manager(), 'product:read', inWs(wsA))).toBe(true);
    expect(can(manager(), 'product:create', inWs(wsA))).toBe(true);
    expect(can(manager(), 'product:update', inWs(wsA))).toBe(true);
    expect(can(manager(), 'product:delete', inWs(wsA))).toBe(false);
  });

  it('can export but cannot run backups', () => {
    expect(can(manager(), 'export:create', inWs(wsA))).toBe(true);
    expect(can(manager(), 'backup:run', inWs(wsA))).toBe(false);
  });

  it('cannot manage team or workspace settings', () => {
    expect(can(manager(), 'team:invite', inWs(wsA))).toBe(false);
    expect(can(manager(), 'team:remove', inWs(wsA))).toBe(false);
    expect(can(manager(), 'workspace:edit_settings', inWs(wsA))).toBe(false);
    expect(can(manager(), 'workspace:rotate_key', inWs(wsA))).toBe(false);
  });

  it('can write stock and use the file manager', () => {
    expect(can(manager(), 'stock:write', inWs(wsA))).toBe(true);
    expect(can(manager(), 'file:upload', inWs(wsA))).toBe(true);
    expect(can(manager(), 'file:delete', inWs(wsA))).toBe(true);
  });
});

describe('permissionPolicy.can — storekeeper', () => {
  it('can read products and write stock movements', () => {
    expect(can(storekeeper(), 'product:read', inWs(wsA))).toBe(true);
    expect(can(storekeeper(), 'stock:read', inWs(wsA))).toBe(true);
    expect(can(storekeeper(), 'stock:write', inWs(wsA))).toBe(true);
  });

  it('cannot create, update, or delete products', () => {
    expect(can(storekeeper(), 'product:create', inWs(wsA))).toBe(false);
    expect(can(storekeeper(), 'product:update', inWs(wsA))).toBe(false);
    expect(can(storekeeper(), 'product:delete', inWs(wsA))).toBe(false);
  });

  it('cannot export', () => {
    expect(can(storekeeper(), 'export:create', inWs(wsA))).toBe(false);
    expect(can(storekeeper(), 'export:read', inWs(wsA))).toBe(false);
  });

  it('can upload files but cannot rename, delete, or create folders', () => {
    expect(can(storekeeper(), 'file:read', inWs(wsA))).toBe(true);
    expect(can(storekeeper(), 'file:upload', inWs(wsA))).toBe(true);
    expect(can(storekeeper(), 'file:rename', inWs(wsA))).toBe(false);
    expect(can(storekeeper(), 'file:delete', inWs(wsA))).toBe(false);
    expect(can(storekeeper(), 'file:create_folder', inWs(wsA))).toBe(false);
  });

  it('cannot touch team or settings or backup', () => {
    expect(can(storekeeper(), 'team:read', inWs(wsA))).toBe(false);
    expect(can(storekeeper(), 'team:invite', inWs(wsA))).toBe(false);
    expect(can(storekeeper(), 'workspace:read_settings', inWs(wsA))).toBe(false);
    expect(can(storekeeper(), 'backup:run', inWs(wsA))).toBe(false);
  });

  it('cannot read the Admin Activity tab', () => {
    expect(can(storekeeper(), 'audit:read_admin_activity', inWs(wsA))).toBe(false);
  });
});

describe('permissionPolicy.can — cross-workspace isolation', () => {
  it('a member of A cannot act on resources tagged B for any role', () => {
    expect(can(primary(wsA), 'product:read', inWs(wsB))).toBe(false);
    expect(can(manager(wsA), 'product:read', inWs(wsB))).toBe(false);
    expect(can(storekeeper(wsA), 'stock:write', inWs(wsB))).toBe(false);
  });
});

describe('permissionPolicy.can — god-mode impersonation', () => {
  const godMode = (workspaceRole: ActorContext['workspaceRole']): ActorContext => ({
    realActorId: adminId,
    realRole: 'admin',
    onBehalfOfId: userId,
    workspaceRole,
    workspaceId: wsA,
    isImpersonating: true,
    impersonationReason: 'Helping fix WA Catalog export',
  });

  it('admin impersonating a storekeeper retains admin powers', () => {
    const actor = godMode('storekeeper');
    expect(can(actor, 'product:delete', inWs(wsA))).toBe(true);
    expect(can(actor, 'export:create', inWs(wsA))).toBe(true);
    expect(can(actor, 'admin:run_system_backup', sys)).toBe(true);
  });

  it('admin impersonating a manager retains admin powers', () => {
    const actor = godMode('manager');
    expect(can(actor, 'workspace:rotate_key', inWs(wsA))).toBe(true);
    expect(can(actor, 'team:remove', inWs(wsA))).toBe(true);
  });

  it('admin impersonating in A still cannot reach into B', () => {
    const actor = godMode('primary');
    expect(can(actor, 'product:read', inWs(wsB))).toBe(false);
  });
});

describe('permissionPolicy.can — unauthenticated / unknown', () => {
  it('actor with no workspace role and no admin role can do nothing', () => {
    const stranger: ActorContext = {
      realActorId: userId,
      realRole: null,
      onBehalfOfId: null,
      workspaceRole: null,
      workspaceId: null,
      isImpersonating: false,
      impersonationReason: null,
    };
    expect(can(stranger, 'product:read', inWs(wsA))).toBe(false);
    expect(can(stranger, 'admin:view_all', sys)).toBe(false);
  });
});
