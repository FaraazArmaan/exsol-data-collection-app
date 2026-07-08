// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// OnboardingLinkButton is rendered inside the SHARED ProductsListPage, which runs
// in two trees: the workspace (has UserAuthProvider) and the admin Product Manager
// (/clients/:clientId/products — NO UserAuthProvider). Reaching for useUserAuth
// directly crashes the admin tree, so the button must gate on useProductsScope.
const scope = vi.fn();
vi.mock('../../products/shared/scope', () => ({ useProductsScope: () => scope() }));

const userAuth = vi.fn();
vi.mock('../../user-portal/user-auth-context', () => ({ useUserAuth: () => userAuth() }));

import { OnboardingLinkButton } from '../OnboardingLinkButton';

describe('OnboardingLinkButton — dual-mode (workspace vs admin) safety', () => {
  beforeEach(() => { scope.mockReset(); userAuth.mockReset(); });

  it('renders nothing in admin mode and never calls useUserAuth (no provider there)', () => {
    scope.mockReturnValue({ mode: 'admin', clientId: 'c1', levelNumber: 1, queryParam: 'c1', permissions: {} });
    // In the admin tree there is no UserAuthProvider — useUserAuth would throw.
    userAuth.mockImplementation(() => { throw new Error('useUserAuth outside UserAuthProvider'); });
    const { container } = render(<OnboardingLinkButton />);
    expect(container).toBeEmptyDOMElement();
    expect(userAuth).not.toHaveBeenCalled();
  });

  it('renders the generate button in workspace mode for an Owner with data-collection enabled', () => {
    scope.mockReturnValue({ mode: 'workspace', clientId: 'c1', levelNumber: 1, queryParam: undefined, permissions: {} });
    userAuth.mockReturnValue({
      user: { level_number: 1 },
      permissions: {},
      enabledModules: [{ key: 'data-collection', label: 'Data Collection' }],
    });
    render(<OnboardingLinkButton />);
    expect(screen.getByText(/Generate onboarding link/i)).toBeInTheDocument();
  });
});
