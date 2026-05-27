import { apiFetch } from '../../lib/api-client';

export interface ClientSummary {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export const listClients = () => apiFetch<{ clients: ClientSummary[] }>('/api/clients');

export const createClient = (name: string) =>
  apiFetch<{ client: ClientSummary }>('/api/clients', {
    method: 'POST', body: JSON.stringify({ name }),
  });

export const deleteClient = (id: string) =>
  apiFetch<{ ok: true }>(`/api/clients-detail?id=${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface AdminMember {
  id: string;
  email: string;
  display_name: string;
  is_bootstrap: boolean;
  has_password: boolean;
  has_google: boolean;
  created_at: string;
}

export const listAdminTeam = () =>
  apiFetch<{ admins: AdminMember[] }>('/api/admin-team');

export const createAdmin = (body: { email: string; display_name: string; password?: string }) =>
  apiFetch<{ admin: AdminMember }>('/api/admin-team', {
    method: 'POST', body: JSON.stringify(body),
  });

export const deleteAdmin = (id: string) =>
  apiFetch<{ ok: true }>(`/api/admin-team-detail?id=${encodeURIComponent(id)}`, { method: 'DELETE' });

export const updateAdminSelf = (body: { display_name?: string; password?: string }) =>
  apiFetch<{ admin: { id: string; email: string; display_name: string; is_bootstrap: boolean } }>(
    '/api/admin-self',
    { method: 'PATCH', body: JSON.stringify(body) },
  );
