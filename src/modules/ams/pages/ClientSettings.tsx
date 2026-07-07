import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ClientProductsSection } from '../components/ClientProductsSection';
import AdminWorkspaceExportCard from '../components/settings/AdminWorkspaceExportCard';
import AdminWorkspaceBrandingCard from '../../branding/AdminWorkspaceBrandingCard';

// Admin client-account "Settings" tab. Consolidates the workspace-configuration
// sections — module enablement (Products), backup export, and branding — that
// previously sat at the bottom of the Access Dashboard. Reached via the client
// sidebar's Settings link (/clients/:clientId/settings).
export default function ClientSettings() {
  const { clientId } = useParams<{ clientId: string }>();
  const [clientSlug, setClientSlug] = useState('');

  useEffect(() => {
    if (!clientId) return;
    void (async () => {
      const r = await fetch(`/api/clients-detail?id=${encodeURIComponent(clientId)}`, { credentials: 'same-origin' });
      if (r.ok) {
        const body = await r.json();
        setClientSlug(body.client.slug);
      }
    })();
  }, [clientId]);

  if (!clientId) return <p className="error">Invalid URL.</p>;

  return (
    <section className="access-dashboard">
      <header className="access-dashboard__header">
        <h1 className="page-title">Settings</h1>
      </header>
      <ClientProductsSection clientId={clientId} />
      <AdminWorkspaceExportCard clientId={clientId} slug={clientSlug} />
      <AdminWorkspaceBrandingCard clientId={clientId} slug={clientSlug} />
    </section>
  );
}
