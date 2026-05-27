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
}

export interface UserPortalClient {
  id: string;
  slug: string;
  name: string;
}

export const getClientBySlug = (slug: string) =>
  apiFetch<{ client: UserPortalClient }>(`/api/u-client-by-slug?slug=${encodeURIComponent(slug)}`);

export const userLogin = (slug: string, email: string, password: string) =>
  apiFetch<{ user: { id: string; email: string; must_change_password: boolean }; client: UserPortalClient }>(
    `/api/u-login?client=${encodeURIComponent(slug)}`,
    { method: 'POST', body: JSON.stringify({ email, password }) },
  );

export const userLogout = () => apiFetch<{ ok: true }>('/api/u-logout', { method: 'POST' });

export const userMe = () =>
  apiFetch<{ user: UserPortalUser; client: UserPortalClient }>('/api/u-me');

export const userChangePassword = (current_password: string, new_password: string) =>
  apiFetch<{ ok: true }>('/api/u-change-password', {
    method: 'POST', body: JSON.stringify({ current_password, new_password }),
  });
