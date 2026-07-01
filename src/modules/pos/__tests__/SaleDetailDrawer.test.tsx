// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SaleDetailDrawer } from '../pages/SaleDetailDrawer';

const pending = {
  id: 's1', order_no: 7, status: 'pending_payment', channel: 'pickup',
  customer_name: 'A', customer_phone: '1', customer_email: null,
  subtotal_cents: 1000, total_cents: 1000, created_at: '2026-06-30T10:00:00Z',
  lines: [{ id: 'l1', product_name_snap: 'Egg', qty: 1, line_total_cents: 1000 }],
  audit: [],
};
const paid = { ...pending, status: 'paid', paid_at: '2026-06-30T10:05:00Z' };

describe('SaleDetailDrawer — reflects a transition without a reload', () => {
  it('uses the authoritative transition response even if the refetch read is stale', async () => {
    // The POST /state returns the just-written (authoritative) row = paid.
    // The follow-up GET (refetch) returns a STALE pending row — simulating
    // read-after-write lag. The pill must reflect the transition, not the stale read.
    vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
      const u = url.toString();
      if (u.includes('/state')) return Promise.resolve(new Response(JSON.stringify(paid), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify(pending), { status: 200 })); // refetch stays stale
    });

    render(
      <SaleDetailDrawer
        saleId="s1"
        perms={new Set(['pos.history.view', 'pos.sale.markPaid'])}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );
    expect(await screen.findByText(/pending pay/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mark paid/i }));
    await waitFor(() => expect(screen.getByText('Paid')).toBeInTheDocument());
    expect(screen.queryByText(/pending pay/i)).not.toBeInTheDocument();
  });

  it('still shows the new status when the refetch fails entirely', async () => {
    let getCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
      const u = url.toString();
      if (u.includes('/state')) return Promise.resolve(new Response(JSON.stringify(paid), { status: 200 }));
      getCount += 1;
      if (getCount === 1) return Promise.resolve(new Response(JSON.stringify(pending), { status: 200 })); // initial load
      return Promise.reject(new Error('network')); // refetch fails
    });
    render(
      <SaleDetailDrawer saleId="s1" perms={new Set(['pos.history.view', 'pos.sale.markPaid'])} onClose={() => {}} onChanged={() => {}} />,
    );
    expect(await screen.findByText(/pending pay/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mark paid/i }));
    await waitFor(() => expect(screen.getByText('Paid')).toBeInTheDocument());
  });

  it('flips the pill optimistically from the POST — before the refetch resolves', async () => {
    let getCount = 0;
    let releaseRefetch!: () => void;
    const gate = new Promise<void>((res) => { releaseRefetch = res; });
    vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
      const u = url.toString();
      if (u.includes('/state')) return Promise.resolve(new Response(JSON.stringify(paid), { status: 200 }));
      getCount += 1;
      if (getCount === 1) return Promise.resolve(new Response(JSON.stringify(pending), { status: 200 })); // initial load
      return gate.then(() => new Response(JSON.stringify(paid), { status: 200 })); // refetch — held open
    });
    render(
      <SaleDetailDrawer saleId="s1" perms={new Set(['pos.history.view', 'pos.sale.markPaid'])} onClose={() => {}} onChanged={() => {}} />,
    );
    expect(await screen.findByText(/pending pay/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /mark paid/i }));
    // Pill must reflect the new status while the refetch is still pending
    // (serial-await code would stay on "Pending pay" until the gate releases).
    await waitFor(() => expect(screen.getByText('Paid')).toBeInTheDocument());
    expect(screen.queryByText(/pending pay/i)).not.toBeInTheDocument();
    releaseRefetch();
  });
});
