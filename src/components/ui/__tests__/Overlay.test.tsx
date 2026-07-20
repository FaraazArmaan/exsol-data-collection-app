// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Overlay } from '../Overlay';

function Example() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return <><button ref={opener} onClick={() => setOpen(true)}>Open booking</button><Overlay open={open} title="Booking detail" description="Review before saving." onClose={() => setOpen(false)}><button>Save booking</button></Overlay></>;
}

describe('Overlay', () => {
  it('moves focus into the dialog, closes on Escape, and returns focus to its opener', async () => {
    render(<Example />);
    const opener = screen.getByRole('button', { name: 'Open booking' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Booking detail' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close Booking detail' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('does not close a non-dismissible destructive dialog on Escape', () => {
    render(<Overlay open title="Delete booking" onClose={() => {}} dismissible={false}><p>This cannot be undone.</p></Overlay>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Delete booking' })).toBeInTheDocument();
  });
});
