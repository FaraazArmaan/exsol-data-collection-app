import { useUserAuth } from '../user-portal/user-auth-context';
import { useBrand } from './useBrand';
import { BrandingForm, type BrandingApi } from './BrandingForm';
import type { DownscaleKind } from './types';

function canEdit(permissions: Record<string, true>, level_number: number | null | undefined): boolean {
  if (level_number == null || level_number === 1) return true;
  return permissions['_platform.settings.edit'] === true;
}

export default function WorkspaceBrandingCard() {
  const { permissions, user, client, loading } = useUserAuth();
  const slug = client?.slug ?? '';
  const { brand } = useBrand(loading ? null : slug);
  if (loading) return null;
  if (!canEdit(permissions as Record<string, true>, (user as { level_number?: number | null }).level_number)) return null;

  const api: BrandingApi = {
    async uploadImage(kind: DownscaleKind, file: File) {
      const form = new FormData(); form.set('kind', kind); form.set('file', file);
      const r = await fetch('/api/client-settings/brand-image', { method: 'POST', credentials: 'include', body: form });
      if (!r.ok) throw new Error(`upload ${r.status}`);
      return r.json() as Promise<{ key: string }>;
    },
    async patch(body) {
      const r = await fetch('/api/client-settings/brand', { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`patch ${r.status}`);
    },
  };

  return (
    <section className="brand-card">
      <h3>Branding</h3>
      <p>Logos, hero images, colors, and fonts for your workspace's customer-facing pages.</p>
      <BrandingForm brand={brand} api={api} />
    </section>
  );
}
