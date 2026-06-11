/** @vitest-environment jsdom */
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductCommerceSection } from '../../src/modules/products/workspace/components/ProductCommerceSection';

const baseProps = {
  price_cents: 1000,
  discount_percent: null,
  gtin: null,
  mpn: null,
  condition: 'new' as const,
  availability: 'in_stock' as const,
  sale_price_cents: null,
  sale_starts_at: null,
  sale_ends_at: null,
  weight_grams: null,
};

describe('ProductCommerceSection — Discount % blur validation', () => {
  test('typing 100 then blurring shows inline error and does NOT commit 100 to onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <details open>
        <ProductCommerceSection {...baseProps} onChange={onChange} />
      </details>,
    );

    const input = screen.getByLabelText('Discount %') as HTMLInputElement;
    await user.click(input);
    await user.type(input, '100');
    await user.tab(); // trigger blur

    // Inline error should be visible.
    expect(screen.getByRole('alert').textContent).toBe('Must be > 0 and < 100');

    // The input should still show the typed value.
    expect(input.value).toBe('100');

    // onChange should NOT have been called with discount_percent: 100.
    const invalidCalls = onChange.mock.calls.filter(
      ([patch]) => patch.discount_percent === 100,
    );
    expect(invalidCalls).toHaveLength(0);
  });

  test('typing 50 then blurring shows no error and commits 50', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <details open>
        <ProductCommerceSection {...baseProps} onChange={onChange} />
      </details>,
    );

    const input = screen.getByLabelText('Discount %') as HTMLInputElement;
    await user.click(input);
    await user.type(input, '50');
    await user.tab();

    expect(screen.queryByRole('alert')).toBeNull();

    const validCalls = onChange.mock.calls.filter(
      ([patch]) => patch.discount_percent === 50,
    );
    expect(validCalls.length).toBeGreaterThan(0);
  });

  test('typing 0 then blurring shows inline error', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <details open>
        <ProductCommerceSection {...baseProps} onChange={onChange} />
      </details>,
    );

    const input = screen.getByLabelText('Discount %') as HTMLInputElement;
    await user.click(input);
    await user.type(input, '0');
    await user.tab();

    expect(screen.getByRole('alert').textContent).toBe('Must be > 0 and < 100');
  });
});
