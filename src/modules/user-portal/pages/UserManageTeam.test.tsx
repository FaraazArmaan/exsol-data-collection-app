// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UserAuthCtxForTesting } from '../user-auth-context';
import UserManageTeam from './UserManageTeam';
import { getStructure, listNodes, peekCredential } from '../team/api';
import type { ClientLevel, ClientRole, UserNode } from '../team/api';

vi.mock('../team/api', () => ({
  getStructure: vi.fn(),
  listNodes: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
  moveNode: vi.fn(),
  getCredential: vi.fn(),
  peekCredential: vi.fn(),
  resetCredential: vi.fn(),
  deleteCredential: vi.fn(),
  bulkInvite: vi.fn(),
  bulkRoleChangeOwner: vi.fn(),
  changeRoleOwner: vi.fn(),
}));

const levels: ClientLevel[] = [
  { id: 'level-1', client_id: 'client-1', level_number: 1, label: 'Primary', created_at: 'now' },
  { id: 'level-2', client_id: 'client-1', level_number: 2, label: 'Secondary', created_at: 'now' },
  { id: 'level-3', client_id: 'client-1', level_number: 3, label: 'Tertiary', created_at: 'now' },
];

const roles: ClientRole[] = [
  role('owner', 'Owner', '#2563eb'),
  role('manager', 'Manager', '#7c3aed'),
  role('stylist', 'Stylist', '#db2777'),
];

const nodes: UserNode[] = [
  node('faraaz', 'Faraaz', 'owner', 1, null),
  node('aisha', 'Aisha', 'manager', 2, 'faraaz'),
  node('manager-2', 'Manager', 'manager', 2, 'faraaz'),
  node('aditya', 'Aditya', 'stylist', 3, 'aisha'),
];

function role(id: string, label: string, color: string): ClientRole {
  return {
    id,
    client_id: 'client-1',
    key: id,
    label,
    color,
    fields: [],
    sort_order: 0,
    created_at: 'now',
    updated_at: 'now',
  };
}

function node(
  id: string,
  displayName: string,
  roleId: string,
  levelNumber: number,
  parentId: string | null,
): UserNode {
  return {
    id,
    client_id: 'client-1',
    parent_id: parentId,
    level_number: levelNumber,
    role_id: roleId,
    display_name: displayName,
    email: `${id}@example.com`,
    phone: null,
    notes: null,
    fields: {},
    sort_order: 0,
    created_at: 'now',
    updated_at: 'now',
  };
}

function renderPage() {
  return render(
    <UserAuthCtxForTesting.Provider
      value={{
        user: { id: 'faraaz', level_number: 1 },
        client: { id: 'client-1', slug: 'papas', name: "Papa's Saloon" },
        permissions: {},
        enabledModules: [],
        loading: false,
        refresh: async () => {},
        signOut: async () => {},
      } as any}
    >
      <MemoryRouter initialEntries={['/c/papas/team']}>
        <Routes>
          <Route path="/c/:slug/team" element={<UserManageTeam />} />
        </Routes>
      </MemoryRouter>
    </UserAuthCtxForTesting.Provider>,
  );
}

beforeEach(() => {
  vi.mocked(getStructure).mockResolvedValue({
    ok: true,
    data: { roles, levels, cardinality_rules: [] },
  });
  vi.mocked(listNodes).mockResolvedValue({ ok: true, data: { nodes } });
  vi.mocked(peekCredential).mockResolvedValue({
    ok: true,
    data: {
      has_credential: false,
      disabled_at: null,
      locked_until: null,
    },
  });
});

describe('UserManageTeam', () => {
  it('does not hide another parent branch after clicking a sibling user card', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Aditya')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('manager-2@example.com'));

    await waitFor(() => expect(screen.getByText('Edit Manager')).toBeInTheDocument());
    expect(screen.getByText('Aditya')).toBeInTheDocument();
  });
});
