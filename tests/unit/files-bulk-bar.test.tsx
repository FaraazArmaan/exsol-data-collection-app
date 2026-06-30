/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { BulkActionBar } from '../../src/modules/files/shared/components/BulkActionBar';

describe('BulkActionBar', () => {
  test('hidden when nothing selected', () => {
    const { container } = render(<BulkActionBar selectedIds={[]} isL1Owner onAction={vi.fn()} onClear={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('Delete triggers soft_delete action with selected ids', () => {
    const onAction = vi.fn();
    render(<BulkActionBar selectedIds={['a', 'b']} isL1Owner onAction={onAction} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(onAction).toHaveBeenCalledWith({ action: 'soft_delete', file_ids: ['a', 'b'] });
  });

  test('shows count of selected', () => {
    render(<BulkActionBar selectedIds={['a', 'b', 'c']} isL1Owner onAction={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
  });

  test('restricted/confidential tier options hidden for non-owner', () => {
    render(<BulkActionBar selectedIds={['a']} isL1Owner={false} onAction={vi.fn()} onClear={vi.fn()} />);
    expect(screen.queryByRole('option', { name: /restricted/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /confidential/i })).not.toBeInTheDocument();
  });
});
