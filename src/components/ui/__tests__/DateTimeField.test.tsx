// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateField, TimeField } from '../DateTimeField';

describe('DateTimeField', () => {
  it('uses an accessible desktop calendar dialog to select a date', () => {
    const onChange = vi.fn();
    render(<DateField label="Booking date" value="2026-07-20" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /booking date:.*20/i }));
    expect(screen.getByRole('dialog', { name: 'Choose booking date' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '21' }));
    expect(onChange).toHaveBeenCalledWith('2026-07-21');
  });

  it('uses an accessible desktop time dialog to select a slot', () => {
    const onChange = vi.fn();
    render(<TimeField label="Start time" value="10:00" onChange={onChange} stepMinutes={30} />);
    fireEvent.click(screen.getByRole('button', { name: /start time:.*10:00/i }));
    expect(screen.getByRole('dialog', { name: 'Choose start time' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: '10:30 AM' }));
    expect(onChange).toHaveBeenCalledWith('10:30');
  });
});
