// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionSwitcher } from '../SectionSwitcher';

describe('SectionSwitcher', () => {
  it('opens a local navigation sheet and returns focus after Escape', () => {
    render(<SectionSwitcher label="Booking sections" activeLabel="Calendar"><nav><a href="/booking/list">Bookings</a></nav></SectionSwitcher>);
    const trigger = screen.getByRole('button', { name: /booking sections · calendar/i });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Booking sections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Booking sections' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
