// src/modules/user-portal/team/api.ts
//
// Owner-scoped API wrappers for Manage Team. Mirrors the team-management
// subset of src/modules/ams/api.ts, but parameter-free where the admin
// version takes clientId — the server resolves the client from the
// bu_session JWT.
//
// Response shapes match the handler return values verbatim (verified
// against netlify/functions/{client-structure,user-nodes,user-nodes-detail,
// user-nodes-move,user-node-credential}.ts). Notably client-structure
// returns the ClientStructure object FLAT (not nested under {structure}).

import { apiFetch } from '../../../lib/api-client';
import type {
  ClientStructure,
  ClientRole,
  ClientLevel,
  UserNode,
  CreateUserNodeBody,
  UserNodeCredentialStatus,
  BulkInviteRowPayload,
} from '../../ams/api';

// ─── Structure ────────────────────────────────────────────────────

// Server returns the ClientStructure object at the top level (see
// netlify/functions/client-structure.ts line 27: `jsonOk(structure …)`).
export const getStructure = () =>
  apiFetch<ClientStructure>('/api/client-structure');

// ─── User nodes ───────────────────────────────────────────────────

export const listNodes = () =>
  apiFetch<{ nodes: UserNode[] }>('/api/user-nodes');

export const createNode = (body: CreateUserNodeBody) =>
  apiFetch<{ node: UserNode; login_created?: boolean }>('/api/user-nodes', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const getNode = (nodeId: string) =>
  apiFetch<{ node: UserNode; children_count: number }>(
    `/api/user-nodes-detail?id=${encodeURIComponent(nodeId)}`,
  );

export const updateNode = (
  nodeId: string,
  body: Partial<Pick<UserNode, 'display_name' | 'email' | 'phone' | 'notes' | 'fields'>>,
) =>
  apiFetch<{ node: UserNode }>(
    `/api/user-nodes-detail?id=${encodeURIComponent(nodeId)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );

export const deleteNode = (nodeId: string, cascade = false) =>
  apiFetch<{ ok: true; deleted_count?: number }>(
    `/api/user-nodes-detail?id=${encodeURIComponent(nodeId)}${cascade ? '&cascade=descendants' : ''}`,
    { method: 'DELETE' },
  );

export const moveNode = (
  nodeId: string,
  parent_id: string | null,
  level_number: number | null,
) =>
  apiFetch<{ node: UserNode } | { ok: true; moved_to: 'unassigned' }>(
    `/api/user-nodes-move?id=${encodeURIComponent(nodeId)}`,
    { method: 'POST', body: JSON.stringify({ parent_id, level_number }) },
  );

// ─── Credentials ──────────────────────────────────────────────────

export const getCredential = (nodeId: string) =>
  apiFetch<UserNodeCredentialStatus>(
    `/api/user-node-credential?node=${encodeURIComponent(nodeId)}`,
  );

// Peek mode: read status without decrementing the reveal counter or
// returning the plaintext temp password.
export const peekCredential = (nodeId: string) =>
  apiFetch<UserNodeCredentialStatus>(
    `/api/user-node-credential?node=${encodeURIComponent(nodeId)}&peek=1`,
  );

export const resetCredential = (nodeId: string, temp_password: string) =>
  apiFetch<{ ok: true }>(
    `/api/user-node-credential?node=${encodeURIComponent(nodeId)}`,
    { method: 'POST', body: JSON.stringify({ temp_password }) },
  );

export const deleteCredential = (nodeId: string) =>
  apiFetch<{ ok: true }>(
    `/api/user-node-credential?node=${encodeURIComponent(nodeId)}`,
    { method: 'DELETE' },
  );

// ─── Bulk operations ──────────────────────────────────────────────

export const bulkInvite = (rows: BulkInviteRowPayload[]) =>
  apiFetch<{ nodes: UserNode[]; login_count: number }>(
    '/api/user-nodes-bulk',
    { method: 'POST', body: JSON.stringify({ rows }) },
  );

export const bulkRoleChangeOwner = (node_ids: string[], new_role_id: string) =>
  apiFetch<{ updated: number }>(
    '/api/user-nodes-bulk-role-change',
    { method: 'POST', body: JSON.stringify({ node_ids, new_role_id }) },
  );

// Re-export the AMS types so consumers can import them from one place.
export type {
  ClientStructure,
  ClientRole,
  ClientLevel,
  UserNode,
  CreateUserNodeBody,
  UserNodeCredentialStatus,
};
