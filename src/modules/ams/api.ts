import { apiFetch, type Result } from '../../lib/api-client';

export interface ClientSummary {
  id: string; name: string; template_key: string;
  template_version_applied: number; schema_name: string; created_at: string;
}

export const listClients = () => apiFetch<{ clients: ClientSummary[] }>('/api/clients');
export const createClient = (name: string, template_key: string) =>
  apiFetch<{ client: ClientSummary }>('/api/clients', {
    method: 'POST', body: JSON.stringify({ name, template_key }),
  });
export const deleteClient = (id: string) =>
  apiFetch<{ ok: true }>(`/api/clients-detail?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
