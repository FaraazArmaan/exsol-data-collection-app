// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BookingStatusPill } from './BookingStatusPill';

describe('BookingStatusPill', () => {
  it('renders booking status with text and a non-textual icon', () => {
    render(<BookingStatusPill status="confirmed" />);
    expect(screen.getByText('confirmed')).toBeInTheDocument();
    expect(screen.getByText('✓')).toHaveAttribute('aria-hidden', 'true');
  });
});
