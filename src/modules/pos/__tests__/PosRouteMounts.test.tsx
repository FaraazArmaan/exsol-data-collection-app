// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { UserAuthCtxForTesting } from '../../user-portal/user-auth-context';
import { PosMenuMount } from '../PosRouteMounts';

const menuFixture = {
  categories: [],
  products: [{ id: 'p1', name: 'Cappuccino', categoryId: null, salePriceCents: 1000, thumbKey: null }],
};

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(menuFixture), { status: 200 }));
  sessionStorage.clear();
  localStorage.clear();
});

const POS_ENABLED = [{ key: 'pos', label: 'POS' }];

function authValue(over: Record<string, unknown>) {
  return {
    user: null,
    client: { id: 'b1', slug: 'acme', name: 'Acme' },
    permissions: {},
    enabledModules: [],
    loading: false,
    refresh: async () => {},
    signOut: async () => {},
    ...over,
  } as any;
}

function renderMenuMount(value: any) {
  return render(
    <UserAuthCtxForTesting.Provider value={value}>
      <MemoryRouter initialEntries={['/c/acme/pos/menu']}>
        <Routes>
          <Route path="/c/:slug/pos/menu" element={<PosMenuMount />} />
          <Route path="/c/:slug" element={<div>DASHBOARD</div>} />
          <Route path="/c/:slug/login" element={<div>LOGIN</div>} />
        </Routes>
      </MemoryRouter>
    </UserAuthCtxForTesting.Provider>,
  );
}

describe('PosMenuMount — L1 bypass + enablement gate', () => {
  it('renders POS for an L1 Owner with an empty matrix (bypass)', async () => {
    const value = authValue({
      user: { id: 'u1', level_number: 1 },
      permissions: {},
      enabledModules: POS_ENABLED,
    });
    renderMenuMount(value);
    expect(await screen.findByText('Cappuccino')).toBeInTheDocument();
    expect(screen.queryByText('DASHBOARD')).not.toBeInTheDocument();
  });

  it('redirects a non-Owner without pos.menu.view', async () => {
    const value = authValue({
      user: { id: 'u2', level_number: 2 },
      permissions: {},
      enabledModules: POS_ENABLED,
    });
    renderMenuMount(value);
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument();
    expect(screen.queryByText('Cappuccino')).not.toBeInTheDocument();
  });

  it('redirects an L1 Owner when POS is not enabled for the workspace', async () => {
    const value = authValue({
      user: { id: 'u1', level_number: 1 },
      permissions: {},
      enabledModules: [], // POS not enabled
    });
    renderMenuMount(value);
    expect(await screen.findByText('DASHBOARD')).toBeInTheDocument();
    expect(screen.queryByText('Cappuccino')).not.toBeInTheDocument();
  });

  it('renders POS for a non-Owner who holds pos.menu.view', async () => {
    const value = authValue({
      user: { id: 'u2', level_number: 2 },
      permissions: { 'pos.menu.view': true },
      enabledModules: POS_ENABLED,
    });
    renderMenuMount(value);
    expect(await screen.findByText('Cappuccino')).toBeInTheDocument();
  });
});
