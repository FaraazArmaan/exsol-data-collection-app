import type { Action, ActorContext, Resource, WorkspaceRole } from './types.ts';

type RoleRow = Record<WorkspaceRole, boolean>;

const RULES: Record<Action, RoleRow | 'admin_only'> = {
  'product:read':         { primary: true,  manager: true,  storekeeper: true  },
  'product:create':       { primary: true,  manager: true,  storekeeper: false },
  'product:update':       { primary: true,  manager: true,  storekeeper: false },
  'product:delete':       { primary: true,  manager: false, storekeeper: false },
  'product:bulk_import':  { primary: true,  manager: true,  storekeeper: false },

  'stock:read':           { primary: true,  manager: true,  storekeeper: true  },
  'stock:write':          { primary: true,  manager: true,  storekeeper: true  },

  'export:create':        { primary: true,  manager: true,  storekeeper: false },
  'export:read':          { primary: true,  manager: true,  storekeeper: false },

  'backup:run':           { primary: true,  manager: false, storekeeper: false },
  'backup:read':          { primary: true,  manager: false, storekeeper: false },
  'backup:download':      { primary: true,  manager: false, storekeeper: false },

  'file:read':            { primary: true,  manager: true,  storekeeper: true  },
  'file:upload':          { primary: true,  manager: true,  storekeeper: true  },
  'file:rename':          { primary: true,  manager: true,  storekeeper: false },
  'file:delete':          { primary: true,  manager: true,  storekeeper: false },
  'file:create_folder':   { primary: true,  manager: true,  storekeeper: false },

  'audit:read':                { primary: true,  manager: true,  storekeeper: false },
  'audit:read_admin_activity': { primary: true,  manager: false, storekeeper: false },

  'team:read':            { primary: true,  manager: true,  storekeeper: false },
  'team:invite':          { primary: true,  manager: false, storekeeper: false },
  'team:remove':          { primary: true,  manager: false, storekeeper: false },
  'team:change_role':     { primary: true,  manager: false, storekeeper: false },

  'workspace:read_settings': { primary: true,  manager: true,  storekeeper: false },
  'workspace:edit_settings': { primary: true,  manager: false, storekeeper: false },
  'workspace:rotate_key':    { primary: true,  manager: false, storekeeper: false },
  'workspace:delete':        { primary: false, manager: false, storekeeper: false },

  'admin:onboard_client':     'admin_only',
  'admin:disable_client':     'admin_only',
  'admin:delete_client':      'admin_only',
  'admin:unlock_workspace':   'admin_only',
  'admin:impersonate':        'admin_only',
  'admin:run_system_backup':  'admin_only',
  'admin:view_all':           'admin_only',
};

export function can(actor: ActorContext, action: Action, resource: Resource): boolean {
  if (
    resource.workspaceId &&
    actor.workspaceId &&
    resource.workspaceId !== actor.workspaceId
  ) {
    return false;
  }

  const rule = RULES[action];

  if (rule === 'admin_only') {
    return actor.realRole === 'admin';
  }

  if (actor.realRole === 'admin') return true;

  if (!actor.workspaceRole) return false;

  return rule[actor.workspaceRole];
}
