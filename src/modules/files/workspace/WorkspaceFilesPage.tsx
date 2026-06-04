import { useUserAuth } from '../../user-portal/user-auth-context';
import { FilesPage } from '../shared/FilesPage';

export default function WorkspaceFilesPage() {
  const { user, client, loading } = useUserAuth();

  if (loading || !client) return <p style={{ color: '#888', padding: 24 }}>Loading…</p>;

  const isL1Owner = user?.level_number === 1 || user?.level_number == null;
  return <FilesPage clientId={client.id} isL1Owner={isL1Owner} />;
}
