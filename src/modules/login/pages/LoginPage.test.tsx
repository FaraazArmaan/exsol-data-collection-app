// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const navigateMock = vi.fn();

vi.mock('../../../lib/auth-context', () => ({
  useAuth: () => ({ refresh: vi.fn() }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../api', () => ({
  unifiedLogin: vi.fn(async () => ({
    ok: true,
    data: { kind: 'admin', admin: { id: 'admin-1', email: 'admin@example.com', display_name: 'Admin', is_bootstrap: false } },
  })),
  unifiedGoogleLogin: vi.fn(),
  completeAdminMfa: vi.fn(),
  forgotPassword: vi.fn(),
}));

vi.mock('../../../lib/google-signin', () => ({
  GoogleSignInButton: () => <div data-testid="google-signin" />,
}));

import LoginPage from './LoginPage';
import { unifiedLogin } from '../api';

beforeEach(() => {
  navigateMock.mockClear();
  vi.mocked(unifiedLogin).mockClear();
});

function renderLogin(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage workspace intent', () => {
  it('does not treat a next=/c/... redirect as explicit workspace login intent', async () => {
    renderLogin('/login?next=%2Fc%2Fpapa-s-saloon%2Fworkforce%2Femployees');

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(unifiedLogin).toHaveBeenCalledTimes(1));
    expect(unifiedLogin).toHaveBeenCalledWith(
      'admin@example.com',
      'secret',
      undefined,
      expect.any(AbortSignal),
    );
  });

  it('honors an explicit client query param for workspace login', async () => {
    renderLogin('/login?client=papa-s-saloon&next=%2Fc%2Fpapa-s-saloon%2Fworkforce%2Femployees');

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(unifiedLogin).toHaveBeenCalledTimes(1));
    expect(unifiedLogin).toHaveBeenCalledWith(
      'admin@example.com',
      'secret',
      'papa-s-saloon',
      expect.any(AbortSignal),
    );
  });
});
