/** @vitest-environment jsdom */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkspaceExportCard from '../../src/modules/ams/components/settings/WorkspaceExportCard';
import { UserAuthCtxForTesting } from '../../src/modules/user-portal/user-auth-context';

function withAuth(opts: {
  permissions: Record<string, true>;
  level_number?: number | null;
  slug?: string;
}) {
  // Renders the card with a stubbed useUserAuth value.
  return (
    <UserAuthCtxForTesting.Provider
      value={{
        user: { id: 'u-1', display_name: 'Test', email: 't@x', level_number: opts.level_number ?? 5 } as never,
        client: { id: 'c-1', slug: opts.slug ?? 'acme', name: 'Acme' } as never,
        permissions: opts.permissions,
        enabledModules: [],
        loading: false,
        refresh: async () => {},
        signOut: async () => {},
      }}
    >
      <WorkspaceExportCard />
    </UserAuthCtxForTesting.Provider>
  );
}

beforeEach(() => {
  global.fetch = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as never;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('WorkspaceExportCard — visibility', () => {
  test('renders when _platform.workspace.view is true', () => {
    render(withAuth({ permissions: { '_platform.workspace.view': true } }));
    expect(screen.getByText(/workspace backup/i)).toBeTruthy();
  });

  test('renders null when no permission and level > 1', () => {
    const { container } = render(withAuth({ permissions: {}, level_number: 5 }));
    expect(container.textContent).toBe('');
  });

  test('L1 bypass: level_number === 1 renders even without explicit perm', () => {
    render(withAuth({ permissions: {}, level_number: 1 }));
    expect(screen.getByText(/workspace backup/i)).toBeTruthy();
  });
});

describe('WorkspaceExportCard — download click', () => {
  test('clicking "Download JSON" calls fetch with ?format=json exactly once', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    global.fetch = f as never;
    render(withAuth({ permissions: { '_platform.workspace.view': true }, slug: 'acme' }));
    fireEvent.click(screen.getByRole('button', { name: /download json/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(f).toHaveBeenCalledTimes(1);
    const firstCallArg = (f.mock.calls as unknown as [string, ...unknown[]][])[0]?.[0] ?? '';
    expect((firstCallArg as string).includes('/api/workspace-export?format=json')).toBe(true);
  });
});
