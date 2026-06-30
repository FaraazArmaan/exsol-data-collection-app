// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { UserAuthCtxForTesting } from '../user-auth-context';
import { Sidebar } from './Sidebar';

function authValue(over: Record<string, unknown>) {
  return {
    user: null, client: { id: 'b1', slug: 'cafe', name: 'Cafe' },
    permissions: {}, enabledModules: [], loading: false,
    refresh: async () => {}, signOut: async () => {}, ...over,
  } as any;
}

function renderSidebar(value: any) {
  return render(
    <UserAuthCtxForTesting.Provider value={value}>
      <MemoryRouter initialEntries={['/c/cafe']}>
        <Routes><Route path="/c/:slug" element={<Sidebar />} /></Routes>
      </MemoryRouter>
    </UserAuthCtxForTesting.Provider>,
  );
}

describe('Sidebar — Storefront settings link', () => {
  it('shows Storefront for an L1 Owner', () => {
    renderSidebar(authValue({ user: { id: 'u1', level_number: 1 } }));
    expect(screen.getByRole('link', { name: 'Storefront' })).toHaveAttribute('href', '/c/cafe/pos/settings');
  });

  it('shows Storefront for a holder of _platform.settings.edit', () => {
    renderSidebar(authValue({ user: { id: 'u2', level_number: 2 }, permissions: { '_platform.settings.edit': true } }));
    expect(screen.getByRole('link', { name: 'Storefront' })).toBeInTheDocument();
  });

  it('hides Storefront from a plain non-Owner', () => {
    renderSidebar(authValue({ user: { id: 'u3', level_number: 2 }, permissions: {} }));
    expect(screen.queryByRole('link', { name: 'Storefront' })).not.toBeInTheDocument();
  });
});

describe('Sidebar — POS Orders link', () => {
  it('shows Orders (→ sale history) for a holder of pos.history.view', () => {
    renderSidebar(authValue({ user: { id: 'u', level_number: 2 }, permissions: { 'pos.history.view': true } }));
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/c/cafe/pos/sales');
    expect(screen.getByRole('link', { name: 'POS' })).toBeInTheDocument();
  });

  it('hides Orders for a user with only pos.menu.view', () => {
    renderSidebar(authValue({ user: { id: 'u', level_number: 2 }, permissions: { 'pos.menu.view': true } }));
    expect(screen.getByRole('link', { name: 'POS' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument();
  });
});
