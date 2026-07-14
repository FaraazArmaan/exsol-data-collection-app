const LEGACY_PUBLIC_BASE_URL = 'https://exsol.app';
const DEFAULT_PUBLIC_BASE_URL = 'https://exsoldatacollectionapp.netlify.app';

export function normalizePublicBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl ?? '').trim().replace(/\/$/, '');
  if (!normalized || normalized === LEGACY_PUBLIC_BASE_URL) return DEFAULT_PUBLIC_BASE_URL;
  return normalized;
}

export function publicStorefrontUrl(slug: string, baseUrl?: string): string {
  return `${normalizePublicBaseUrl(baseUrl)}/storefront/${slug}`;
}

export function publicBookingUrl(slug: string, baseUrl?: string): string {
  return `${normalizePublicBaseUrl(baseUrl)}/book/${slug}`;
}
