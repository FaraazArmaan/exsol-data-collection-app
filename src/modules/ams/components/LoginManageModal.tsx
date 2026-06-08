// Thin admin wrapper around the shared LoginManageModal. See ../../shared/team-modals.

import { useMemo } from 'react';
import type { UserNode } from '../api';
import { LoginManageModal as SharedLoginManageModal } from '../../shared/team-modals/LoginManageModal';
import { buildAdminApiNoCreate, adminCopy } from './team-modal-api';

interface Props {
  clientId: string;
  node: UserNode;
  clientSlug: string;
  onClose: () => void;
  onChanged: () => void;
}

export function LoginManageModal({ clientId, ...props }: Props) {
  const api = useMemo(() => buildAdminApiNoCreate(clientId), [clientId]);
  return <SharedLoginManageModal api={api} copy={adminCopy} {...props} />;
}
