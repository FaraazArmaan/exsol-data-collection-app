// Admin-side TeamMemberApi factory + copy bag. Shared by the three thin
// wrappers around src/modules/shared/team-modals/*.

import {
  createUserNode, patchUserNode, deleteUserNode, moveUserNode,
  getUserNodeCredential, peekUserNodeCredential,
  resetUserNodeCredential, deleteUserNodeCredential,
  bulkInviteUsers, bulkRoleChange, changeRole,
} from '../api';
import type { TeamMemberApi, TeamMemberCopy } from '../../shared/team-modals/types';

// AddUserNodeModal needs createNode (which takes clientId), so this is a
// factory rather than a singleton. The other endpoints key off node id and
// don't need clientId, but we close over it uniformly for consistency.
export function buildAdminApi(clientId: string): TeamMemberApi {
  return {
    createNode: (body) => createUserNode(clientId, body),
    updateNode: (id, body) => patchUserNode(id, body),
    deleteNode: (id, cascade) => deleteUserNode(id, cascade),
    moveNode: (id, p, l) => moveUserNode(id, p, l),
    getCredential: (id) => getUserNodeCredential(id),
    peekCredential: (id) => peekUserNodeCredential(id),
    resetCredential: (id) => resetUserNodeCredential(id),
    deleteCredential: (id) => deleteUserNodeCredential(id),
    bulkInvite: (rows) => bulkInviteUsers(clientId, rows),
    bulkRoleChange: (ids, rid) => bulkRoleChange(clientId, ids, rid),
    changeRole: (id, rid) => changeRole(clientId, id, rid),
  };
}

// Edit/Login modals don't need createNode/bulk surfaces but the shared
// TeamMemberApi shape includes them. Stub the unused ones to a clear error
// rather than silently no-op'ing. `changeRole` needs clientId though, so this
// is a factory rather than a singleton (matches buildAdminApi above).
export function buildAdminApiNoCreate(clientId: string): TeamMemberApi {
  return {
    createNode: () => Promise.resolve({ ok: false, error: { code: 'not_supported' } }),
    updateNode: (id, body) => patchUserNode(id, body),
    deleteNode: (id, cascade) => deleteUserNode(id, cascade),
    moveNode: (id, p, l) => moveUserNode(id, p, l),
    getCredential: (id) => getUserNodeCredential(id),
    peekCredential: (id) => peekUserNodeCredential(id),
    resetCredential: (id) => resetUserNodeCredential(id),
    deleteCredential: (id) => deleteUserNodeCredential(id),
    bulkInvite: () => Promise.resolve({ ok: false, error: { code: 'not_supported' } }),
    bulkRoleChange: () => Promise.resolve({ ok: false, error: { code: 'not_supported' } }),
    changeRole: (id, rid) => changeRole(clientId, id, rid),
  };
}

// Admin-side copy. AddUserNodeModal overrides noLevelsHint / noLevelForRoleHint
// with clientId-aware links to /clients/:id/configure; Edit/Login don't use
// those hints so they get null defaults.
export const adminCopy: TeamMemberCopy = {
  scopeNoun: 'client',
  noLevelsHint: null,
  noLevelForRoleHint: () => null,
};
