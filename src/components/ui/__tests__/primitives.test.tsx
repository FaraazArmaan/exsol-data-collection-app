// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, IconButton } from '../Button';
import { ErrorState, LoadingState, PermissionState } from '../Feedback';

describe('shared UI primitives', () => {
  it('makes a loading button busy and unavailable while preserving its accessible status', () => {
    render(<Button loading loadingLabel="Saving booking">Save booking</Button>);
    const button = screen.getByRole('button', { name: 'Saving booking' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('requires an accessible name for icon-only actions', () => {
    render(<IconButton label="Close drawer">×</IconButton>);
    expect(screen.getByRole('button', { name: 'Close drawer' })).toBeInTheDocument();
  });

  it('distinguishes loading, error, and permission states for assistive technology', () => {
    render(<><LoadingState>Loading bookings.</LoadingState><ErrorState title="Could not save">Try again.</ErrorState><PermissionState>Ask an owner to update access.</PermissionState></>);
    expect(screen.getByText('Loading…').closest('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.getByText('You do not have access to this action.')).toBeInTheDocument();
  });
});
