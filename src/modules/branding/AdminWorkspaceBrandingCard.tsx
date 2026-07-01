import { useBrand } from './useBrand';
import { BrandingForm, type BrandingApi } from './BrandingForm';
import type { DownscaleKind } from './types';

export default function AdminWorkspaceBrandingCard({ clientId, slug }: { clientId: string; slug: string }) {
  const { brand } = useBrand(slug);
  const api: BrandingApi = {
    async uploadImage(kind: DownscaleKind, file: File) {
      const form = new FormData(); form.set('kind', kind); form.set('file', file);
      const r = await fetch(`/api/client-settings/brand-image?client=${encodeURIComponent(clientId)}`, { method: 'POST', credentials: 'include', body: form });
      if (!r.ok) throw new Error(`upload ${r.status}`);
      return r.json() as Promise<{ key: string }>;
    },
    async patch(body) {
      const r = await fetch(`/api/client-settings/brand?client=${encodeURIComponent(clientId)}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`patch ${r.status}`);
    },
  };
  return (
    <section className="brand-card">
      <h3>Branding</h3>
      <p>Logos, hero images, colors, and fonts for this workspace's customer-facing pages.</p>
      <BrandingForm brand={brand} api={api} />
    </section>
  );
}
