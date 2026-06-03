// Thin admin wrapper around the shared AddUserModal.
// Builds an admin TeamMemberApi that closes over `clientId` (the shared
// component is clientId-agnostic — owner endpoints resolve scope from JWT).

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { ClientRole, ClientLevel, UserNode } from '../api';
import { AddUserModal } from '../../shared/team-modals/AddUserModal';
import type { TeamMemberCopy } from '../../shared/team-modals/types';
import { buildAdminApi } from './team-modal-api';

interface Props {
  clientId: string;
  clientSlug: string;
  roles: ClientRole[];
  levels: ClientLevel[];
  nodes: UserNode[];
  presetLevel?: number | null;
  presetParent?: string | null;
  onClose: () => void;
  onCreated: () => void;
}

export function AddUserNodeModal(props: Props) {
  const { clientId } = props;
  const api = useMemo(() => buildAdminApi(clientId), [clientId]);

  // Admin hints link into the /configure surface — only the admin has that
  // route, so we override the shared copy with clientId-aware Links.
  const copy: TeamMemberCopy = useMemo(() => ({
    scopeNoun: 'client',
    noLevelsHint: (
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
        No levels exist yet. <Link to={`/clients/${clientId}/configure`}>Add a level first</Link>, or check "Create as unassigned" above.
      </p>
    ),
    noLevelForRoleHint: (roleLabel) => (
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--warning, #f59e0b)' }}>
        ⚠ {roleLabel} isn't marked allowed at any level. You can still pick one,
        but you'll get a friendlier setup by toggling {roleLabel} on at least one level under <Link to={`/clients/${clientId}/configure`}>Configure structure</Link>.
      </p>
    ),
  }), [clientId]);

  return <AddUserModal api={api} copy={copy} {...props} />;
}
