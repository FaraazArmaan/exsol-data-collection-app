// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Link: ({ to, children, ...rest }: any) => <a href={typeof to === 'string' ? to : '#'} {...rest}>{children}</a>,
    useNavigate: () => navigateMock,
  };
});

const signOutMock = vi.fn(async () => {
  expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
});
vi.mock('../user-auth-context', () => ({
  useUserAuth: () => ({
    user: { display_name: 'Faraaz' },
    client: { slug: 'papa-s-saloon', name: "Papa's Saloon" },
    signOut: signOutMock,
  }),
}));

import { TopBar } from '../layout/TopBar';

describe('TopBar', () => {
  it('navigates to the plain login page before clearing the workspace session', async () => {
    render(
      <MemoryRouter>
        <TopBar />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /faraaz/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(signOutMock).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith('/login', { replace: true });
  });
});
