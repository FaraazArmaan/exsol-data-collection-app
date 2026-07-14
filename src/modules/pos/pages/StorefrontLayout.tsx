import { Outlet, useParams } from 'react-router-dom';
import { BrandShell, PublicSurfaceNav, useBrand } from '../../branding';

// Public storefront layout. Fetches the tenant brand ONCE for the whole guest
// flow (menu → cart → details → receipt) and wraps every page in the shared
// BrandShell. Brand is applied best-effort: storefront availability rides on
// each page's own fetch (e.g. pub-menu 404), NEVER on the brand — a workspace
// can have a brand while its storefront is disabled. See branding spec §9.4.
export default function StorefrontLayout() {
  const { slug } = useParams<{ slug: string }>();
  const { brand } = useBrand(slug);
  return (
    <BrandShell brand={brand ?? undefined} fallbackName="Online ordering">
      {slug ? <PublicSurfaceNav slug={slug} /> : null}
      <Outlet />
    </BrandShell>
  );
}
