// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const navigateMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('../api', () => ({ userChangePassword: vi.fn(async () => ({ ok: true })) }));
vi.mock('../user-auth-context', () => ({
  useUserAuth: () => ({ user: { must_change_password: true }, refresh: refreshMock }),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import UserChangePassword from './UserChangePassword';
import { userChangePassword } from '../api';

beforeEach(() => {
  navigateMock.mockClear();
  refreshMock.mockClear();
  vi.mocked(userChangePassword).mockClear();
});

describe('UserChangePassword shared controls', () => {
  it('uses shared fields and preserves the password-update request', async () => {
    render(<MemoryRouter initialEntries={['/c/acme/change-password']}><Routes><Route path="/c/:slug/change-password" element={<UserChangePassword />} /></Routes></MemoryRouter>);

    const current = screen.getByLabelText(/current password/i);
    expect(current).toHaveClass('ui-input');
    fireEvent.change(current, { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => expect(userChangePassword).toHaveBeenCalledWith('old-password', 'new-password'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/c/acme', { replace: true }));
  });
});
