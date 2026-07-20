// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const navigateMock = vi.fn();

vi.mock('../api', () => ({
  getClientBySlug: vi.fn(async () => ({ ok: true, data: { client: { name: 'Acme' } } })),
  userLogin: vi.fn(async () => ({ ok: true, data: { user: { must_change_password: false } } })),
}));

vi.mock('../user-auth-context', () => ({
  useUserAuth: () => ({ refresh: vi.fn(), user: null, loading: false }),
}));

vi.mock('../../../lib/google-signin', () => ({ GoogleSignInButton: () => <div data-testid="google-signin" /> }));
vi.mock('../../login/api', () => ({ unifiedGoogleLogin: vi.fn(), forgotPassword: vi.fn() }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import UserLogin from './UserLogin';
import { userLogin } from '../api';

beforeEach(() => {
  navigateMock.mockClear();
  vi.mocked(userLogin).mockClear();
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/c/acme/login']}>
      <Routes><Route path="/c/:slug/login" element={<UserLogin />} /></Routes>
    </MemoryRouter>,
  );
}

describe('UserLogin shared controls', () => {
  it('uses shared fields and submits browser-populated values to the selected workspace', async () => {
    renderLogin();
    await screen.findByText('Acme');

    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    const password = screen.getByLabelText(/password/i) as HTMLInputElement;
    expect(email).toHaveClass('ui-input');
    expect(screen.getByRole('button', { name: /^sign in$/i })).toHaveClass('ui-button');

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(email, 'person@example.com');
    setValue.call(password, 'autofill-secret');
    fireEvent.submit(email.form!);

    await waitFor(() => expect(userLogin).toHaveBeenCalledWith('acme', 'person@example.com', 'autofill-secret'));
  });
});
