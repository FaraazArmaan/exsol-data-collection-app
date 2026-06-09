/** @vitest-environment jsdom */
import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useProductsScope, WorkspaceProductsScopeProvider, AdminProductsScopeProvider } from '../../src/modules/products/shared/scope';

// Mock the user-portal auth context.
vi.mock('../../src/modules/user-portal/user-auth-context', () => ({
  useUserAuth: () => ({
    user:        { id: 'u1', display_name: 'U', email: 'u@e.com', level_number: 2, role: { key: 'k', label: 'L', color: '#000' } } as any,
    client:      { id: 'client-W', slug: 'workspace', name: 'W' } as any,
    permissions: { 'products.products.view': true } as any,
    enabledModules: [] as any,
    loading: false,
    refresh: async () => {},
    signOut: async () => {},
  }),
}));

// Mock the admin auth context.
vi.mock('../../src/lib/auth-context', () => ({
  useAuth: () => ({
    admin: { id: 'a1', email: 'admin@e.com' } as any,
    loading: false,
    signOut: async () => {},
    signIn: async () => true,
  }),
}));

function ScopeProbe({ onScope }: { onScope: (s: ReturnType<typeof useProductsScope>) => void }) {
  const s = useProductsScope();
  onScope(s);
  return null;
}

describe('useProductsScope', () => {
  test('throws when used outside a provider', () => {
    expect(() => render(<ScopeProbe onScope={() => {}} />)).toThrow(/scope/i);
  });

  test('WorkspaceProductsScopeProvider yields workspace shape', () => {
    let captured: any;
    render(
      <WorkspaceProductsScopeProvider>
        <ScopeProbe onScope={(s) => { captured = s; }} />
      </WorkspaceProductsScopeProvider>,
    );
    expect(captured).toEqual({
      clientId: 'client-W',
      levelNumber: 2,
      queryParam: undefined,
      mode: 'workspace',
      permissions: { 'products.products.view': true },
    });
  });

  test('AdminProductsScopeProvider yields admin shape with clientId from URL', () => {
    let captured: any;
    render(
      <MemoryRouter initialEntries={['/clients/abc-123/products']}>
        <Routes>
          <Route
            path="/clients/:clientId/products"
            element={
              <AdminProductsScopeProvider>
                <ScopeProbe onScope={(s) => { captured = s; }} />
              </AdminProductsScopeProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(captured).toEqual({
      clientId: 'abc-123',
      levelNumber: 1,
      queryParam: 'abc-123',
      mode: 'admin',
      permissions: {},
    });
  });

  test('AdminProductsScopeProvider without :clientId URL param throws', () => {
    const swallow = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(
      <MemoryRouter initialEntries={['/clients/products']}>
        <Routes>
          <Route
            path="/clients/products"
            element={
              <AdminProductsScopeProvider>
                <ScopeProbe onScope={() => {}} />
              </AdminProductsScopeProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    )).toThrow(/clientId/i);
    swallow.mockRestore();
  });
});
