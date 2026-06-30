// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAnalytics } from '../hooks/useAnalytics';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({
      scope: { isRootScope: true, nodeCount: 0 },
      kpis: [], series: [], breakdowns: [], generatedAt: 'x',
    }),
  })) as any);
});

describe('useAnalytics', () => {
  it('loads sales data', async () => {
    const { result } = renderHook(() => useAnalytics('sales', { from: '2026-06-01', to: '2026-06-30' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeTruthy();
    expect(result.current.error).toBeNull();
  });

  it('surfaces an error on a failed response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })) as any);
    const { result } = renderHook(() => useAnalytics('sales', { from: '2026-06-01', to: '2026-06-30' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });
});
