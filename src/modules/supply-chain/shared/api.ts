import type {
  SectionKey, SupplierLinksResponse, ProductsWithSuppliersResponse,
  CreateSupplierLinkBody, CreateSupplierLinkResponse, RiskResponse,
  DrillType, DrillResponse, Co2Response, UpsertCo2FactorBody, UpsertCo2FactorResponse,
  BriefResponse,
} from './types';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

const ENDPOINT: Record<SectionKey, string> = {
  inventory: '/api/supply-chain-inventory',
  procurement: '/api/supply-chain-procurement',
  manufacturing: '/api/supply-chain-manufacturing',
};

export function fetchSection<T>(section: SectionKey): Promise<T> {
  return apiFetch<T>(ENDPOINT[section]);
}

export function fetchSupplierLinks(productId: string): Promise<SupplierLinksResponse> {
  return apiFetch<SupplierLinksResponse>(`/api/supply-chain-suppliers?product=${productId}`);
}

export function fetchProductsWithSuppliers(): Promise<ProductsWithSuppliersResponse> {
  return apiFetch<ProductsWithSuppliersResponse>('/api/supply-chain-suppliers');
}

export function createSupplierLink(body: CreateSupplierLinkBody): Promise<CreateSupplierLinkResponse> {
  return apiFetch<CreateSupplierLinkResponse>('/api/supply-chain-suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deleteSupplierLink(id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/supply-chain-suppliers/${id}`, { method: 'DELETE' });
}

export function fetchRisk(): Promise<RiskResponse> {
  return apiFetch<RiskResponse>('/api/supply-chain-risk');
}

export function fetchDrill(type: DrillType, id: string): Promise<DrillResponse> {
  return apiFetch<DrillResponse>(
    `/api/supply-chain-drill?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`,
  );
}

export function fetchCo2(): Promise<Co2Response> {
  return apiFetch<Co2Response>('/api/supply-chain-co2');
}

export function upsertCo2Factor(body: UpsertCo2FactorBody): Promise<UpsertCo2FactorResponse> {
  return apiFetch<UpsertCo2FactorResponse>('/api/supply-chain-co2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function fetchBrief(): Promise<BriefResponse> {
  return apiFetch<BriefResponse>('/api/supply-chain-brief');
}
