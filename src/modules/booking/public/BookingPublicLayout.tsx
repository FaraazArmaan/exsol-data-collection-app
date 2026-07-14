import { Outlet, useParams } from 'react-router-dom';
import { BrandShell, PublicSurfaceNav, useBrand } from '../../branding';

export default function BookingPublicLayout() {
  const { slug } = useParams<{ slug: string }>();
  const { brand } = useBrand(slug);
  return (
    <BrandShell brand={brand ?? undefined} fallbackName="Online booking">
      {slug ? <PublicSurfaceNav slug={slug} /> : null}
      <Outlet />
    </BrandShell>
  );
}
