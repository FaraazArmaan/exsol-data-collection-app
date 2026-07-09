// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api', () => ({
  putLevelPermissions: vi.fn(async () => ({ ok: true, data: { ok: true } })),
}));
import { putLevelPermissions } from '../api';
import { PermissionMatrixCard } from './PermissionMatrixCard';

const baseData = {
  level_id: 'lvl-2',
  level_number: 2,
  permissions: {} as Record<string, true>,
  module_rows: [],
  platform_rows: [
    { surface: 'users', verbs: ['view', 'create', 'edit', 'delete'] },
  ],
  action_groups: [
    {
      product_key: 'pos',
      label: 'POS',
      actions: [
        { key: 'pos.menu.view', label: 'View menu / add to cart' },
        { key: 'pos.sale.markPaid', label: 'Mark sale paid (cash)' },
      ],
    },
  ],
};

beforeEach(() => {
  (putLevelPermissions as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe('PermissionMatrixCard — action-namespace grants', () => {
  it('renders a toggle per declared action', () => {
    render(<PermissionMatrixCard data={baseData as any} levelLabel="Secondary" onSaved={() => {}} />);
    expect(screen.getByText('POS')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Mark sale paid (cash)' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'View menu / add to cart' })).toBeInTheDocument();
    expect(screen.getByText('Can remove workspace users')).toBeInTheDocument();
  });

  it('reflects already-granted actions as ON', () => {
    const data = { ...baseData, permissions: { 'pos.sale.markPaid': true } };
    render(<PermissionMatrixCard data={data as any} levelLabel="Secondary" onSaved={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Mark sale paid (cash)' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'View menu / add to cart' })).toHaveAttribute('aria-checked', 'false');
  });

  it('toggling an action and saving sends the pos.* key in the PUT payload', async () => {
    const onSaved = vi.fn();
    render(<PermissionMatrixCard data={baseData as any} levelLabel="Secondary" onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Mark sale paid (cash)' }));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(putLevelPermissions).toHaveBeenCalledTimes(1));
    expect(putLevelPermissions).toHaveBeenCalledWith('lvl-2', { 'pos.sale.markPaid': true });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
