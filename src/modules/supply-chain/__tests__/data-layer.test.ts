// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { visibleSectionsFor } from '../gating';
import { formatCents, formatCount } from '../format';
import { fetchSection } from '../api';
import { useSupplyChain } from '../hooks/useSupplyChain';

afterEach(() => vi.unstubAllGlobals());

describe('gating', () => {
  it('shows only sections whose backing module is enabled', () => {
    expect(visibleSectionsFor(new Set(['inventory']))).toEqual(['inventory']);
    expect(visibleSectionsFor(new Set(['procurement', 'manufacturing', 'pos'])))
      .toEqual(['procurement', 'manufacturing']);
    expect(visibleSectionsFor(new Set())).toEqual([]);
  });
});

describe('format', () => {
  it('formats cents as INR and counts with grouping', () => {
    expect(formatCents(50000)).toContain('500');
    expect(formatCount(1234)).toBe('1,234');
  });
});

describe('fetchSection', () => {
  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    await expect(fetchSection('inventory')).rejects.toThrow('403');
  });
});

describe('useSupplyChain', () => {
  it('resolves to data on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: 1 }) })));
    const { result } = renderHook(() => useSupplyChain('inventory'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ ok: 1 });
    expect(result.current.error).toBeNull();
  });
});
