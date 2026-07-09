import { apiFetch } from '../../lib/api-client';
import type { OnboardClientBulkBody, OnboardClientBulkSuccess } from '../shared/onboarding-import/types';

export interface ClientSummary {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export const listClients = () => apiFetch<{ clients: ClientSummary[] }>('/api/clients');

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

export interface AdminMfaStatus {
  enabled: boolean;
  recovery_codes_remaining: number;
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

export const getAdminMfaStatus = () =>
  apiFetch<AdminMfaStatus>('/api/auth-mfa-status');

export const startAdminMfaEnroll = () =>
  apiFetch<{ secret: string; otpauth_url: string }>('/api/auth-mfa-enroll', { method: 'POST' });

export const confirmAdminMfaEnroll = (code: string) =>
  apiFetch<{ enabled: true; recovery_codes: string[] }>('/api/auth-mfa-confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

export const disableAdminMfa = (body: { code?: string; recovery_code?: string }) =>
  apiFetch<{ enabled: false }>('/api/auth-mfa-disable', {
    method: 'POST',
    body: JSON.stringify(body),
  });

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
  bucket_family?: 'business' | 'employees' | 'customers' | 'products' | null;
  created_at: string;
  updated_at: string;
}

export interface ClientLevel {
  id: string;
  client_id: string;
  level_number: number;
  label: string | null;
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

export const createRole = (clientId: string, body: { key: string; label: string; color: string; fields?: RoleFieldDef[]; bucket_family?: 'business' | 'employees' | 'customers' | 'products' }) =>
  apiFetch<{ role: ClientRole }>(`/api/client-roles?client=${encodeURIComponent(clientId)}`, {
    method: 'POST', body: JSON.stringify(body),
  });

export const patchRole = (roleId: string, body: Partial<{ label: string; color: string; fields: RoleFieldDef[]; sort_order: number; bucket_family: 'business' | 'employees' | 'customers' | 'products' | null }>) =>
  apiFetch<{ role: ClientRole }>(`/api/client-roles-detail?id=${encodeURIComponent(roleId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });

export const deleteRole = (roleId: string) =>
  apiFetch<{ ok: true }>(`/api/client-roles-detail?id=${encodeURIComponent(roleId)}`, { method: 'DELETE' });

export const createLevel = (clientId: string, body: { level_number: number; label?: string }) =>
  apiFetch<{ level: ClientLevel }>(`/api/client-levels?client=${encodeURIComponent(clientId)}`, {
    method: 'POST', body: JSON.stringify(body),
  });

export const patchLevel = (levelId: string, body: Partial<{ label: string }>) =>
  apiFetch<{ level: ClientLevel }>(`/api/client-levels-detail?id=${encodeURIComponent(levelId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });

export const deleteLevel = (levelId: string) =>
  apiFetch<{ ok: true }>(`/api/client-levels-detail?id=${encodeURIComponent(levelId)}`, { method: 'DELETE' });

export const putCardinality = (clientId: string, rules: Array<{ parent_role_id: string | null; child_role_id: string; max_children: number }>) =>
  apiFetch<{ ok: true }>(`/api/client-cardinality?client=${encodeURIComponent(clientId)}`, {
    method: 'PUT', body: JSON.stringify({ rules }),
  });

// ─── v3: user nodes ────────────────────────────────────────────────

export interface UserNode {
  id: string;
  client_id: string;
  parent_id: string | null;
  level_number: number | null;
  role_id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  fields: Record<string, unknown>;
  sort_order: number;
  has_login?: boolean;
  has_reset_request?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateUserNodeBody {
  role_id: string;
  parent_id?: string | null;
  level_number?: number | null;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  fields?: Record<string, unknown>;
  create_login?: boolean;
  temp_password?: string;
}

export const listUserNodes = (clientId: string) =>
  apiFetch<{ nodes: UserNode[] }>(`/api/user-nodes?client=${encodeURIComponent(clientId)}`);

export const createUserNode = (clientId: string, body: CreateUserNodeBody) =>
  apiFetch<{ node: UserNode; login_created?: boolean }>(`/api/user-nodes?client=${encodeURIComponent(clientId)}`, {
    method: 'POST', body: JSON.stringify(body),
  });

export const patchUserNode = (nodeId: string, body: Partial<Pick<UserNode, 'display_name' | 'email' | 'phone' | 'notes' | 'fields'>>) =>
  apiFetch<{ node: UserNode }>(`/api/user-nodes-detail?id=${encodeURIComponent(nodeId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  });

export const deleteUserNode = (nodeId: string, cascade = false) =>
  apiFetch<{ ok: true; deleted_count?: number }>(
    `/api/user-nodes-detail?id=${encodeURIComponent(nodeId)}${cascade ? '&cascade=descendants' : ''}`,
    { method: 'DELETE' },
  );

export const moveUserNode = (nodeId: string, parent_id: string | null, level_number: number | null) =>
  apiFetch<{ node: UserNode }>(`/api/user-nodes-move?id=${encodeURIComponent(nodeId)}`, {
    method: 'POST', body: JSON.stringify({ parent_id, level_number }),
  });

// ─── v3: user-node credentials ─────────────────────────────────────

export interface UserNodeCredentialStatus {
  has_credential: boolean;
  email?: string;
  has_password?: boolean;
  has_google?: boolean;
  must_change_password?: boolean;
  last_login_at?: string | null;
  password_reset_requested_at?: string | null;
  temp_password_plain?: string | null;
  temp_password_views_left?: number | null;
}

export interface UserNodeCredentialResetLink {
  ok: true;
  set_password_url: string;
  expires_at: string;
  purpose: 'invite' | 'reset';
}

export const getUserNodeCredential = (nodeId: string) =>
  apiFetch<UserNodeCredentialStatus>(`/api/user-node-credential?node=${encodeURIComponent(nodeId)}`);

// Peek mode: read status without decrementing the reveal counter or returning
// the plaintext temp password. Use when displaying status badges.
export const peekUserNodeCredential = (nodeId: string) =>
  apiFetch<UserNodeCredentialStatus>(`/api/user-node-credential?node=${encodeURIComponent(nodeId)}&peek=1`);

export const resetUserNodeCredential = (nodeId: string) =>
  apiFetch<UserNodeCredentialResetLink>(`/api/user-node-credential?node=${encodeURIComponent(nodeId)}`, {
    method: 'POST', body: JSON.stringify({ issue_link: true }),
  });

export const deleteUserNodeCredential = (nodeId: string) =>
  apiFetch<{ ok: true }>(`/api/user-node-credential?node=${encodeURIComponent(nodeId)}`, { method: 'DELETE' });

// ─── v3: bulk operations ──────────────────────────────────────────

export interface BulkInviteRowPayload {
  display_name: string;
  role_key: string;
  level_number?: number | null;
  parent_email?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  create_login?: boolean;
  temp_password?: string;
}

export const bulkInviteUsers = (clientId: string, rows: BulkInviteRowPayload[]) =>
  apiFetch<{ nodes: UserNode[]; login_count: number }>(
    `/api/user-nodes-bulk?client=${encodeURIComponent(clientId)}`,
    { method: 'POST', body: JSON.stringify({ rows }) },
  );

export const bulkRoleChange = (clientId: string, node_ids: string[], new_role_id: string) =>
  apiFetch<{ updated: number }>(
    `/api/user-nodes-bulk-role-change?client=${encodeURIComponent(clientId)}`,
    { method: 'POST', body: JSON.stringify({ node_ids, new_role_id }) },
  );

export const changeRole = (clientId: string, node_id: string, new_role_id: string) =>
  apiFetch<{ node: UserNode; no_change?: boolean }>(
    `/api/user-nodes-role-change?client=${encodeURIComponent(clientId)}`,
    { method: 'POST', body: JSON.stringify({ node_id, new_role_id }) },
  );

// ─── Admin: enabled Products per Client ────────────────────────────

export interface ProductAvailable { key: string; label: string }

export interface AdminClientProductsResponse {
  enabled_keys: string[];
  available: ProductAvailable[];
}

export const getAdminClientProducts = (clientId: string) =>
  apiFetch<AdminClientProductsResponse>(`/api/admin-client-products?client=${encodeURIComponent(clientId)}`);

export const putAdminClientProducts = (clientId: string, keys: string[]) =>
  apiFetch<{ ok: true }>(`/api/admin-client-products?client=${encodeURIComponent(clientId)}`, {
    method: 'PUT', body: JSON.stringify({ keys }),
  });

// ─── Access Level permissions ──────────────────────────────────────

export interface ModuleRow {
  module_key: string;
  label: string;
  bucket: string;
  verbs: string[];
}

export interface PlatformRow { surface: string; verbs: string[] }

// Action-namespace permissions (e.g. POS's pos.<action> keys) — a flat list of
// toggles per Product, rendered separately from the bucket×verb grid.
export interface ActionGroupRow {
  product_key: string;
  label: string;
  actions: { key: string; label: string }[];
}

export interface LevelPermissionsResponse {
  level_id: string;
  level_number: number;
  permissions: Record<string, true>;
  module_rows: ModuleRow[];
  platform_rows: PlatformRow[];
  action_groups: ActionGroupRow[];
}

export const getLevelPermissions = (levelId: string) =>
  apiFetch<LevelPermissionsResponse>(`/api/client-levels-permissions?id=${encodeURIComponent(levelId)}`);

export const putLevelPermissions = (levelId: string, permissions: Record<string, true>) =>
  apiFetch<{ ok: true }>(`/api/client-levels-permissions?id=${encodeURIComponent(levelId)}`, {
    method: 'PUT', body: JSON.stringify({ permissions }),
  });

// ---------------------------------------------------------------------------
// Onboarding wizard
// ---------------------------------------------------------------------------
export interface OnboardClientBody {
  name: string;
  enabled_products: string[];
  roles: Array<{ key: string; label: string; color: string; bucket_family?: 'business' | 'employees' | 'customers' | 'products' | null }>;
  levels: Array<{ level_number: number; label?: string | null }>;
  cardinality_rules: Array<{ parent_role_key: string | null; child_role_key: string; max_children: number }>;
  owner: { display_name: string; email: string; phone?: string | null; notes?: string | null; temp_password: string };
}

export const onboardClient = (body: OnboardClientBody) =>
  apiFetch<{ client: { id: string; name: string; slug: string } }>('/api/onboard-client', {
    method: 'POST', body: JSON.stringify(body),
  });

// ─── Bulk onboarding (XLSX import path) ────────────────────────────

export const onboardClientBulk = (body: OnboardClientBulkBody) =>
  apiFetch<OnboardClientBulkSuccess>('/api/onboard-client-bulk', {
    method: 'POST', body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditLogActor {
  kind: 'admin' | 'bucket_user' | 'unknown';
  id: string | null;
  label: string;
}

export interface AuditLogEntry {
  id: number;
  occurred_at: string;
  actor: AuditLogActor;
  op: string;
  client_id: string | null;
  client_name: string | null;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  detail: Record<string, unknown> | null;
}

export interface AuditLogFilter {
  actor_admin?: string;
  actor_user_node?: string;
  client_id?: string;
  op?: string;
  target_type?: string;
  target_id?: string;
  since?: string;
  until?: string;
  page?: number;
  page_size?: number;
}

export const listAuditLog = (filter: AuditLogFilter = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const qs = q.toString();
  return apiFetch<{ entries: AuditLogEntry[]; total: number; page: number; page_size: number }>(
    `/api/audit-log${qs ? `?${qs}` : ''}`,
  );
};
