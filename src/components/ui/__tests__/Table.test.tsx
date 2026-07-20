// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusBadge } from '../StatusBadge';
import { SelectionBar, TableFrame } from '../Table';

describe('shared table primitives', () => {
  it('keeps a semantic caption while allowing responsive overflow styling', () => {
    render(<TableFrame caption="Bookings scheduled for today"><thead><tr><th>Customer</th></tr></thead><tbody><tr><td>Mira Shah</td></tr></tbody></TableFrame>);
    expect(screen.getByRole('table', { name: 'Bookings scheduled for today' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Customer' })).toBeInTheDocument();
  });

  it('reveals batch actions only after selection and names the count', () => {
    const clear = vi.fn();
    render(<SelectionBar count={3} onClear={clear}><button type="button">Archive</button></SelectionBar>);
    expect(screen.getByRole('region', { name: '3 selected' })).toHaveTextContent('3 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(clear).toHaveBeenCalledOnce();
  });

  it('requires textual status alongside its icon', () => {
    render(<StatusBadge icon="✓" label="Confirmed" tone="success" />);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('✓')).toHaveAttribute('aria-hidden', 'true');
  });
});
