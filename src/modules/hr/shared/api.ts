// Throw-on-error HR API client. Auth rides the httpOnly bucket-user cookie, so
// every call is a plain same-origin fetch (workspace-scoped, no client param).
import type {
  OrgNode, ChecklistKind, ChecklistTemplate, ChecklistInstanceSummary, ChecklistItem, HrDashboard,
} from './types';

export class HrApiError extends Error {
  constructor(public status: number, public code: string, public detail: unknown) {
    super(`${code} (${status})`);
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = (body as { error?: { code?: string } } | null)?.error;
    throw new HrApiError(res.status, err?.code ?? 'http_error', body);
  }
  return body as T;
}

interface TemplateItemInput { label: string; description?: string; action_hint?: string }

export const hrApi = {
  org: (): Promise<{ nodes: OrgNode[] }> => jsonFetch('/api/hr/org'),
  dashboard: (): Promise<HrDashboard> => jsonFetch('/api/hr/dashboard'),

  templates: (kind: ChecklistKind): Promise<{ templates: ChecklistTemplate[] }> =>
    jsonFetch(`/api/hr/checklist-templates?kind=${kind}`),
  createTemplate: (kind: ChecklistKind, name: string, items: TemplateItemInput[]): Promise<{ id: string }> =>
    jsonFetch('/api/hr/checklist-templates', { method: 'POST', body: JSON.stringify({ kind, name, items }) }),

  instances: (kind: ChecklistKind): Promise<{ instances: ChecklistInstanceSummary[] }> =>
    jsonFetch(`/api/hr/checklist-instances?kind=${kind}`),
  startInstance: (kind: ChecklistKind, subjectUserNodeId: string, templateId: string | null): Promise<{ id: string }> =>
    jsonFetch('/api/hr/checklist-instances', {
      method: 'POST',
      body: JSON.stringify({ kind, subject_user_node_id: subjectUserNodeId, template_id: templateId }),
    }),

  instance: (id: string): Promise<{ instance: ChecklistInstanceSummary; items: ChecklistItem[] }> =>
    jsonFetch(`/api/hr/checklist-instance?id=${encodeURIComponent(id)}`),
  toggleItem: (instanceId: string, itemId: string, done: boolean): Promise<{ ok: true }> =>
    jsonFetch(`/api/hr/checklist-instance?id=${encodeURIComponent(instanceId)}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'toggle-item', item_id: itemId, done }),
    }),
  completeInstance: (id: string): Promise<{ ok: true }> =>
    jsonFetch(`/api/hr/checklist-instance?id=${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ action: 'complete' }),
    }),
};

// Thin wrappers over EXISTING AMS endpoints — offboarding orchestrates them,
// never reimplements node lifecycle. Each enforces its own _platform.users.*
// permission server-side (an Owner passes; a non-owner without the grant gets 403).
async function amsCall(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  if (!res.ok) {
    const text = await res.text();
    const code = (text ? (safeJson(text) as { error?: { code?: string } } | null)?.error?.code : null) ?? `http_${res.status}`;
    throw new HrApiError(res.status, code, text);
  }
}

export const amsOps = {
  // Revoke login by deleting the credential (keeps the node in the tree).
  disableLogin: (nodeId: string): Promise<void> =>
    amsCall(`/api/user-node-credential?node=${encodeURIComponent(nodeId)}`, { method: 'DELETE' }),
  // Move a node (+ its subtree) under a new parent — used to reassign reports.
  moveNode: (nodeId: string, parentId: string | null, levelNumber: number | null): Promise<void> =>
    amsCall(`/api/user-nodes-move?id=${encodeURIComponent(nodeId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent_id: parentId, level_number: levelNumber }),
    }),
};
