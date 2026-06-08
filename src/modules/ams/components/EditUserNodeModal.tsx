// Thin admin wrapper around the shared EditUserModal. See ../../shared/team-modals.

import { useMemo } from 'react';
import type { ClientRole, ClientLevel, UserNode } from '../api';
import { EditUserModal } from '../../shared/team-modals/EditUserModal';
import { buildAdminApiNoCreate, adminCopy } from './team-modal-api';

interface Props {
  clientId: string;
  node: UserNode;
  role: ClientRole | undefined;
  roles: ClientRole[];
  levels: ClientLevel[];
  clientSlug: string;
  nodes: UserNode[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onManageLogin: () => void;
}

export function EditUserNodeModal({ clientId, ...props }: Props) {
  const api = useMemo(() => buildAdminApiNoCreate(clientId), [clientId]);
  // Admin is not a bucket_user, so it can never be the target of a role change.
  // canChangeRole: true unlocks the picker; self-target guard is moot.
  return (
    <EditUserModal
      api={api}
      copy={adminCopy}
      caps={{ canChangeRole: true }}
      callerUserNodeId={null}
      {...props}
    />
  );
}
