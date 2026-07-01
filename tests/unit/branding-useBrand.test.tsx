/** @vitest-environment jsdom */
import { describe, expect, test, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBrand } from '../../src/modules/branding/useBrand';

const SAMPLE = { name: 'Acme', logoUrl: null, logoAltUrl: null, faviconUrl: null, appIconUrl: null, socialUrl: null, heroUrls: [], accent: '#3b82f6', theme: 'light', fontHeading: 'Inter', fontBody: null };

afterEach(() => { vi.restoreAllMocks(); });

describe('useBrand', () => {
  test('success sets brand + clears loading', async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(SAMPLE), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    const { result } = renderHook(() => useBrand('acme'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brand?.name).toBe('Acme');
    expect(result.current.error).toBeNull();
  });

  test('HTTP error sets error, null brand', async () => {
    global.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as never;
    const { result } = renderHook(() => useBrand('missing'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brand).toBeNull();
    expect(result.current.error).not.toBeNull();
  });

  test('null slug → idle, no fetch', async () => {
    const f = vi.fn();
    global.fetch = f as never;
    const { result } = renderHook(() => useBrand(null));
    expect(result.current.loading).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
