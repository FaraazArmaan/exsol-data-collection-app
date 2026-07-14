const LEGACY_PUBLIC_BASE_URL = 'https://exsol.app';
const DEFAULT_PUBLIC_BASE_URL = 'https://exsoldatacollectionapp.netlify.app';

export function normalizePublicBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl ?? '').replace(/\/$/, '');
  if (!normalized || normalized === LEGACY_PUBLIC_BASE_URL) return DEFAULT_PUBLIC_BASE_URL;
  return normalized;
}

export function publicStorefrontUrl(slug: string, baseUrl?: string): string {
  return `${normalizePublicBaseUrl(baseUrl)}/storefront/${slug}`;
}

export function storefrontBasePath(pathname: string, slug: string): string {
  return pathname.startsWith(`/storefront/${slug}`) ? `/storefront/${slug}` : `/menu/${slug}`;
}

export function storefrontPath(pathname: string, slug: string, suffix = ''): string {
  const base = storefrontBasePath(pathname, slug);
  const normalizedSuffix = suffix ? `/${suffix.replace(/^\/+/, '')}` : '';
  return `${base}${normalizedSuffix}`;
}
