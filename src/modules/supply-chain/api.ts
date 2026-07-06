import type { SectionKey } from './types';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

const ENDPOINT: Record<SectionKey, string> = {
  inventory: '/api/supply-chain-inventory',
  procurement: '/api/supply-chain-procurement',
  manufacturing: '/api/supply-chain-manufacturing',
};

export function fetchSection<T>(section: SectionKey): Promise<T> {
  return get<T>(ENDPOINT[section]);
}
