// Shared team-modal API + copy contracts.
//
// The 3 modals (Add/Edit/LoginManage) used to exist as 6 files — an AMS pair
// (admin-scoped) and an owner pair under user-portal/team. The JSX was
// ~identical; only the api wrappers and a few hint/error strings differed.
//
// We consolidate them by:
//   1. Defining a single `TeamMemberApi` shape the modals depend on.
//   2. Letting each call site inject its own wrappers (admin closes over
//      clientId; owner relies on JWT-scoped endpoints, no clientId param).
//   3. Letting each call site inject a small `copy` bag for the few user-
//      facing strings that differ ("client" vs "workspace", admin link
//      hint vs owner static hint).

import type {
  CreateUserNodeBody,
  UserNode,
  UserNodeCredentialStatus,
} from '../../ams/api';
import type { ReactNode } from 'react';

// Result shape mirrors `apiFetch`. We can't import the helper's return type
// without circular imports, so we redeclare the discriminated union.
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; details?: unknown } };

export interface BulkInviteRow {
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

export interface TeamMemberApi {
  createNode: (
    body: CreateUserNodeBody,
  ) => Promise<ApiResult<{ node: UserNode; login_created?: boolean }>>;
  updateNode: (
    nodeId: string,
    body: Partial<Pick<UserNode, 'display_name' | 'email' | 'phone' | 'notes' | 'fields'>>,
  ) => Promise<ApiResult<{ node: UserNode }>>;
  deleteNode: (
    nodeId: string,
    cascade?: boolean,
  ) => Promise<ApiResult<{ ok: true; deleted_count?: number }>>;
  getCredential: (nodeId: string) => Promise<ApiResult<UserNodeCredentialStatus>>;
  peekCredential: (nodeId: string) => Promise<ApiResult<UserNodeCredentialStatus>>;
  resetCredential: (
    nodeId: string,
    temp_password: string,
  ) => Promise<ApiResult<{ ok: true }>>;
  deleteCredential: (nodeId: string) => Promise<ApiResult<{ ok: true }>>;
  bulkInvite: (
    rows: BulkInviteRow[],
  ) => Promise<ApiResult<{ nodes: UserNode[]; login_count: number }>>;
  bulkRoleChange: (
    node_ids: string[],
    new_role_id: string,
  ) => Promise<ApiResult<{ updated: number }>>;
}

// Per-surface user-facing copy. Keeps the JSX shared while letting admin vs
// owner customise the few strings that differ.
export interface TeamMemberCopy {
  // "client" (admin) vs "workspace" (owner) — used in collision errors.
  scopeNoun: string;
  // What to render when no levels are configured. Admin links to the
  // /configure page; owner shows a static hint pointing at the admin.
  noLevelsHint: ReactNode;
  // What to render when admin defined levels but didn't toggle this role on
  // any of them. Admin links to /configure; owner says "ask your admin".
  // `roleLabel` is the friendly role name (e.g. "Manager").
  noLevelForRoleHint: (roleLabel: string) => ReactNode;
}
