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

// ─── v3: client structure ───────────────────────────────────────────

export interface RoleFieldDef {
  key: string;
  label: string;
  type: 'text' | 'date' | 'integer' | 'boolean';
  required: boolean;
  default?: string | number | boolean;
  help?: string;
  display_in_list?: boolean;
}

export interface ClientRole {
  id: string;
  client_id: string;
  key: string;
  label: string;
  color: string;
  fields: RoleFieldDef[];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ClientLevel {
  id: string;
  client_id: string;
  level_number: number;
  label: string | null;
  allowed_role_ids: string[];
  created_at: string;
}

export interface ClientCardinalityRule {
  id: string;
  client_id: string;
  parent_role_id: string | null;
  child_role_id: string;
  max_children: number;
}

export interface ClientStructure {
  roles: ClientRole[];
  levels: ClientLevel[];
  cardinality_rules: ClientCardinalityRule[];
}

export const getClientStructure = (clientId: string) =>
  apiFetch<ClientStructure>(`/api/client-structure?client=${encodeURIComponent(clientId)}`);

export const createRole = (clientId: string, body: { key: string; label: string; color: string; fields?: RoleFieldDef[] }) =>
  apiFetch<{ role: ClientRole }>(`/api/client-roles?client=${encodeURIComponent(clientId)}`, {
    method: 'POST', body: JSON.stringify(body),
  });

export const patchRole = (roleId: string, body: Partial<{ label: string; color: string; fields: RoleFieldDef[]; sort_order: number }>) =>
  apiFetch<{ role: ClientRole }>(`/api/client-roles-detail?id=${encodeURIComponent(roleId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });

export const deleteRole = (roleId: string) =>
  apiFetch<{ ok: true }>(`/api/client-roles-detail?id=${encodeURIComponent(roleId)}`, { method: 'DELETE' });

export const createLevel = (clientId: string, body: { level_number: number; label?: string; allowed_role_ids: string[] }) =>
  apiFetch<{ level: ClientLevel }>(`/api/client-levels?client=${encodeURIComponent(clientId)}`, {
    method: 'POST', body: JSON.stringify(body),
  });

export const patchLevel = (levelId: string, body: Partial<{ label: string; allowed_role_ids: string[] }>) =>
  apiFetch<{ level: ClientLevel }>(`/api/client-levels-detail?id=${encodeURIComponent(levelId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });

export const deleteLevel = (levelId: string) =>
  apiFetch<{ ok: true }>(`/api/client-levels-detail?id=${encodeURIComponent(levelId)}`, { method: 'DELETE' });

export const putCardinality = (clientId: string, rules: Array<{ parent_role_id: string | null; child_role_id: string; max_children: number }>) =>
  apiFetch<{ ok: true }>(`/api/client-cardinality?client=${encodeURIComponent(clientId)}`, {
    method: 'PUT', body: JSON.stringify({ rules }),
  });
