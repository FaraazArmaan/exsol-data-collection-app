// Thin admin wrapper around the shared LoginManageModal. See ../../shared/team-modals.

import type { UserNode } from '../api';
import { LoginManageModal as SharedLoginManageModal } from '../../shared/team-modals/LoginManageModal';
import { adminApiNoCreate, adminCopy } from './team-modal-api';

interface Props {
  node: UserNode;
  clientSlug: string;
  onClose: () => void;
  onChanged: () => void;
}

export function LoginManageModal(props: Props) {
  return <SharedLoginManageModal api={adminApiNoCreate} copy={adminCopy} {...props} />;
}
