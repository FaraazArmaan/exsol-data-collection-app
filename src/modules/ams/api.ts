import { apiFetch, type Result } from '../../lib/api-client';

export interface ClientSummary {
  id: string; name: string; template_key: string;
  template_version_applied: number; schema_name: string; slug: string; created_at: string;
}

export const listClients = () => apiFetch<{ clients: ClientSummary[] }>('/api/clients');
export const createClient = (name: string, template_key: string) =>
  apiFetch<{ client: ClientSummary }>('/api/clients', {
    method: 'POST', body: JSON.stringify({ name, template_key }),
  });
export const deleteClient = (id: string) =>
  apiFetch<{ ok: true }>(`/api/clients-detail?id=${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface BucketColumn {
  key: string;
  label: string;
  type: 'text' | 'date' | 'integer' | 'boolean';
  required: boolean;
  default?: unknown;
  display_in_list?: boolean;
  help?: string;
}

export interface BucketSummary {
  role: string;
  label: string;
  cardinality: 'singleton' | 'multi';
  count: number;
  columns: BucketColumn[];
}

export interface BucketUser {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  [key: string]: unknown; // custom columns
}

export interface ClientHeader {
  id: string;
  name: string;
  slug: string;
  template_key: string;
  template_label: string;
  created_at: string;
}

export const getClientBuckets = (clientId: string) =>
  apiFetch<{ client: ClientHeader; buckets: BucketSummary[] }>(
    `/api/clients-buckets?client=${encodeURIComponent(clientId)}`,
  );

export const listBucketUsers = (clientId: string, role: string) =>
  apiFetch<{ users: BucketUser[] }>(
    `/api/clients-bucket-users?client=${encodeURIComponent(clientId)}&role=${encodeURIComponent(role)}`,
  );

export const addBucketUser = (clientId: string, role: string, values: Record<string, unknown>) =>
  apiFetch<{ user: BucketUser; login_created?: boolean }>(
    `/api/clients-bucket-users?client=${encodeURIComponent(clientId)}&role=${encodeURIComponent(role)}`,
    { method: 'POST', body: JSON.stringify(values) },
  );

export interface BucketUserCredentialStatus {
  has_credential: boolean;
  email?: string;
  must_change_password?: boolean;
  last_login_at?: string | null;
  temp_password_plain?: string | null;
  temp_password_views_left?: number | null;
}

export const getBucketUserCredential = (clientId: string, role: string, userId: string) =>
  apiFetch<BucketUserCredentialStatus>(
    `/api/bucket-user-credential?client=${encodeURIComponent(clientId)}&role=${encodeURIComponent(role)}&user=${encodeURIComponent(userId)}`,
  );

export const resetBucketUserCredential = (clientId: string, role: string, userId: string, tempPassword: string) =>
  apiFetch<{ ok: true }>(
    `/api/bucket-user-credential?client=${encodeURIComponent(clientId)}&role=${encodeURIComponent(role)}&user=${encodeURIComponent(userId)}`,
    { method: 'POST', body: JSON.stringify({ temp_password: tempPassword }) },
  );

export const deleteBucketUserCredential = (clientId: string, role: string, userId: string) =>
  apiFetch<{ ok: true }>(
    `/api/bucket-user-credential?client=${encodeURIComponent(clientId)}&role=${encodeURIComponent(role)}&user=${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );

export const updateBucketUser = (clientId: string, role: string, userId: string, values: Record<string, unknown>) =>
  apiFetch<{ user: BucketUser }>(
    `/api/clients-bucket-user-detail?client=${encodeURIComponent(clientId)}&role=${encodeURIComponent(role)}&user=${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: JSON.stringify(values) },
  );

export const deleteBucketUser = (clientId: string, role: string, userId: string) =>
  apiFetch<{ ok: true }>(
    `/api/clients-bucket-user-detail?client=${encodeURIComponent(clientId)}&role=${encodeURIComponent(role)}&user=${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );

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
