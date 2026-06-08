// Owner-side TeamMemberApi + copy bag for src/modules/shared/team-modals/*.
//
// The owner wrappers don't take a clientId — the server resolves scope from
// the bu_session JWT. So unlike the admin side this is a singleton, not a
// factory.

import {
  createNode, updateNode, deleteNode, moveNode as moveOwnerNode,
  getCredential, peekCredential, resetCredential, deleteCredential,
  bulkInvite, bulkRoleChangeOwner, changeRoleOwner,
} from './api';
import type { TeamMemberApi, TeamMemberCopy } from '../../shared/team-modals/types';

export const ownerApi: TeamMemberApi = {
  createNode: (body) => createNode(body),
  updateNode: (id, body) => updateNode(id, body),
  deleteNode: (id, cascade) => deleteNode(id, cascade),
  moveNode: (id, p, l) => moveOwnerNode(id, p, l),
  getCredential: (id) => getCredential(id),
  peekCredential: (id) => peekCredential(id),
  resetCredential: (id, pw) => resetCredential(id, pw),
  deleteCredential: (id) => deleteCredential(id),
  bulkInvite: (rows) => bulkInvite(rows),
  bulkRoleChange: (ids, rid) => bulkRoleChangeOwner(ids, rid),
  changeRole: (id, rid) => changeRoleOwner(id, rid),
};

// Owner-side copy. "workspace" (rather than "client") in collision errors;
// hints don't link into the admin /configure surface (owners don't have it).
export const ownerCopy: TeamMemberCopy = {
  scopeNoun: 'workspace',
  noLevelsHint: (
    <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
      No levels exist yet. Ask your admin to configure structure, or check "Create as unassigned" above.
    </p>
  ),
  noLevelForRoleHint: (roleLabel) => (
    <p className="muted" style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--warning, #f59e0b)' }}>
      ⚠ {roleLabel} isn't marked allowed at any level. You can still pick one,
      but ask your admin to toggle {roleLabel} on at least one level for a cleaner setup.
    </p>
  ),
};
