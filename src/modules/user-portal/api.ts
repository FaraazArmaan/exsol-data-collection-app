import { apiFetch } from '../../lib/api-client';

export interface UserPortalUser {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  fields: Record<string, unknown>;
  level_number: number | null;
  role: { key: string; label: string; color: string };
  must_change_password: boolean;
  has_google: boolean;
}

export interface UserPortalClient {
  id: string;
  slug: string;
  name: string;
}

export interface UserPortalEnabledModule {
  key: string;
  label: string;
}

// PermissionMatrix is a flat map: 'module.bucket.verb' → true.
// Absent keys are denied.
export type UserPortalPermissionMatrix = Record<string, true>;

export const getClientBySlug = (slug: string) =>
  apiFetch<{ client: UserPortalClient }>(`/api/u-client-by-slug?slug=${encodeURIComponent(slug)}`);

export const userLogin = (slug: string, email: string, password: string) =>
  apiFetch<{ user: { id: string; email: string; must_change_password: boolean }; client: UserPortalClient }>(
    `/api/u-login?client=${encodeURIComponent(slug)}`,
    { method: 'POST', body: JSON.stringify({ email, password }) },
  );

export const userLogout = () => apiFetch<{ ok: true }>('/api/u-logout', { method: 'POST' });

export const userMe = () =>
  apiFetch<{
    user: UserPortalUser;
    client: UserPortalClient;
    permissions: UserPortalPermissionMatrix;
    enabled_modules: UserPortalEnabledModule[];
  }>('/api/u-me');

export const userLinkGoogle = (idToken: string) =>
  apiFetch<{ ok: true }>('/api/u-link-google', {
    method: 'POST', body: JSON.stringify({ idToken }),
  });

export const userUnlinkGoogle = () =>
  apiFetch<{ ok: true; already_unlinked?: true }>('/api/u-unlink-google', {
    method: 'POST',
  });

export const userChangePassword = (current_password: string, new_password: string) =>
  apiFetch<{ ok: true }>('/api/u-change-password', {
    method: 'POST', body: JSON.stringify({ current_password, new_password }),
  });
