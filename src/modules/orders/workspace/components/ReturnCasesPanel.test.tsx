// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReturnCasesPanel from './ReturnCasesPanel';

const api = vi.hoisted(() => ({
  listReturnCases: vi.fn(),
  advanceReturnCase: vi.fn(),
  requestReturnRefund: vi.fn(),
}));

vi.mock('../../shared/api', () => ({
  OrdersApiError: class OrdersApiError extends Error {},
  ordersApi: api,
}));

const perms = new Set(['orders.business.view', 'orders.business.create', 'orders.business.edit']);

describe('ReturnCasesPanel', () => {
  beforeEach(() => {
    api.listReturnCases.mockResolvedValue([{
      id: 'case-1', sale_id: 'sale-1', status: 'authorized', request_reason: 'Too small', refusal_reason: null,
      created_at: '2026-07-23T08:00:00.000Z', authorized_at: '2026-07-23T09:00:00.000Z', refused_at: null,
      order_no: 1048, customer_name: 'Priya',
      lines: [{ id: 'line-1', sale_line_id: 'sale-line-1', qty: 1, reason: 'Too small', inventory_return_id: 'inventory-return-1', refund_id: null, refund_state: null, provider_refund_status: null }],
    }]);
    api.advanceReturnCase.mockReset();
    api.requestReturnRefund.mockResolvedValue({ id: 'refund-1', state: 'requested', amount_cents: 100 });
  });

  it('shows ownership boundaries and requests an Orders refund intent only after Inventory receipt', async () => {
    render(<ReturnCasesPanel perms={perms} />);
    expect(await screen.findByText('Order #1048')).toBeTruthy();
    expect(screen.getByText('Receipt recorded by Inventory')).toBeTruthy();
    expect(screen.getByText('Refund not requested')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Request refund intent' }));
    await waitFor(() => expect(api.requestReturnRefund).toHaveBeenCalledWith('case-1', 'line-1', 'Too small'));
    expect(await screen.findByText(/Payments now owns provider submission/i)).toBeTruthy();
  });

  it('requires a reason before refusing a requested return', async () => {
    api.listReturnCases.mockResolvedValueOnce([{ id: 'case-2', sale_id: 'sale-2', status: 'requested', request_reason: null, refusal_reason: null, created_at: '2026-07-23T08:00:00.000Z', authorized_at: null, refused_at: null, order_no: 1049, customer_name: 'Sam', lines: [] }]);
    render(<ReturnCasesPanel perms={perms} />);
    await screen.findByText('Order #1049');
    fireEvent.click(screen.getByRole('button', { name: 'Refuse return' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refusal' }));
    expect(await screen.findByText(/Add a short refusal reason/i)).toBeTruthy();
    expect(api.advanceReturnCase).not.toHaveBeenCalled();
  });
});
