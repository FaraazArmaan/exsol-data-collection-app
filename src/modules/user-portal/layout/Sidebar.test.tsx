// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { UserAuthCtxForTesting } from '../user-auth-context';
import { Sidebar } from './Sidebar';

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

function renderSidebar(value: any) {
  return render(
    <UserAuthCtxForTesting.Provider value={value}>
      <MemoryRouter initialEntries={['/c/acme']}>
        <Routes>
          <Route path="/c/:slug" element={<Sidebar />} />
        </Routes>
      </MemoryRouter>
    </UserAuthCtxForTesting.Provider>,
  );
}

describe('Sidebar — POS link visibility', () => {
  it('shows POS for an L1 Owner with an empty matrix when POS is enabled', () => {
    renderSidebar(authValue({ user: { id: 'u1', level_number: 1 }, enabledModules: POS_ENABLED }));
    expect(screen.getByRole('link', { name: 'POS' })).toBeInTheDocument();
  });

  it('hides POS for an L1 Owner when POS is NOT enabled', () => {
    renderSidebar(authValue({ user: { id: 'u1', level_number: 1 }, enabledModules: [] }));
    expect(screen.queryByRole('link', { name: 'POS' })).not.toBeInTheDocument();
  });

  it('shows POS for a non-Owner who holds pos.menu.view', () => {
    renderSidebar(authValue({
      user: { id: 'u2', level_number: 2 },
      permissions: { 'pos.menu.view': true },
      enabledModules: POS_ENABLED,
    }));
    expect(screen.getByRole('link', { name: 'POS' })).toBeInTheDocument();
  });

  it('hides POS for a non-Owner with no POS permission', () => {
    renderSidebar(authValue({
      user: { id: 'u2', level_number: 2 },
      permissions: {},
      enabledModules: POS_ENABLED,
    }));
    expect(screen.queryByRole('link', { name: 'POS' })).not.toBeInTheDocument();
  });
});
