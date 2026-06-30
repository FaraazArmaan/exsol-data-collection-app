import type { BulkAction, BulkResult, FileRow, ListFilters, ListResponse, QuotaResponse, UploadCommitBody } from './types';

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) { super(`api ${status}`); }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) {
    let detail: unknown = null;
    try { detail = await res.json(); } catch { /* */ }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export async function listFiles(clientId: string | null, filters: ListFilters): Promise<ListResponse> {
  const sp = new URLSearchParams();
  if (clientId) sp.set('client', clientId);
  if (filters.type) sp.set('type', filters.type);
  if (filters.search) sp.set('search', filters.search);
  if (filters.sort) sp.set('sort', filters.sort);
  for (const c of filters.category ?? []) sp.append('category', c);
  return jsonFetch<ListResponse>(`/api/files?${sp.toString()}`);
}

export async function getFile(id: string): Promise<{ file: FileRow }> {
  return jsonFetch(`/api/files-detail/${id}`);
}

export async function patchFile(id: string, body: Partial<UploadCommitBody>): Promise<{ ok: true }> {
  return jsonFetch(`/api/files-detail/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deleteFile(id: string, hard = false): Promise<void> {
  await fetch(`/api/files-detail/${id}${hard ? '?hard=true' : ''}`, {
    method: 'DELETE', credentials: 'include',
  });
}

export async function reserveUploadUrl(file: { name: string; type: string; size: number }):
  Promise<{ blob_key: string; upload_token: string; upload_url: string }> {
  return jsonFetch('/api/files-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, mime: file.type, byte_size: file.size }),
  });
}

export async function uploadBytes(token: string, mime: string, body: Blob): Promise<void> {
  const res = await fetch(`/api/files-upload?token=${token}`, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    credentials: 'include',
    body,
  });
  if (!res.ok) throw new ApiError(res.status, await res.text());
}

export async function commitFile(body: UploadCommitBody): Promise<{ file: FileRow }> {
  return jsonFetch('/api/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function getQuota(clientId: string): Promise<QuotaResponse> {
  const sp = new URLSearchParams({ client_id: clientId });
  return jsonFetch<QuotaResponse>(`/api/files-quota?${sp.toString()}`);
}

export async function bulkAction(body: BulkAction): Promise<BulkResult> {
  return jsonFetch<BulkResult>('/api/files-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
