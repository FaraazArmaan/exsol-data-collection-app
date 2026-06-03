// Thin admin wrapper around the shared EditUserModal. See ../../shared/team-modals.

import type { ClientRole, UserNode } from '../api';
import { EditUserModal } from '../../shared/team-modals/EditUserModal';
import { adminApiNoCreate, adminCopy } from './team-modal-api';

interface Props {
  node: UserNode;
  role: ClientRole | undefined;
  clientSlug: string;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onManageLogin: () => void;
}

export function EditUserNodeModal(props: Props) {
  return <EditUserModal api={adminApiNoCreate} copy={adminCopy} {...props} />;
}
