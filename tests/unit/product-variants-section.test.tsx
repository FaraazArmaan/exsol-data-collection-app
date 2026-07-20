/** @vitest-environment jsdom */
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const variantApi = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock('../../src/modules/products/shared/api', () => ({ variantsApi: variantApi }));

import { ProductVariantsSection } from '../../src/modules/products/workspace/components/ProductVariantsSection';

describe('ProductVariantsSection', () => {
  test('creates a draft variant with structured options and no stock field', async () => {
    variantApi.list.mockResolvedValueOnce({ items: [] });
    variantApi.create.mockResolvedValueOnce({ id: 'variant-1', title: 'Medium / Blue', sku: 'SHIRT-M-BLU', barcode: null, price_cents: null });
    const user = userEvent.setup();
    render(<details open><ProductVariantsSection productId="product-1" canEdit /></details>);
    await waitFor(() => expect(variantApi.list).toHaveBeenCalledWith('product-1', { clientId: undefined }));
    await user.type(screen.getByLabelText('Variant name'), 'Medium / Blue');
    await user.type(screen.getByLabelText('Options'), 'size=M, color=Blue');
    await user.type(screen.getByLabelText('Variant SKU'), 'SHIRT-M-BLU');
    await user.click(screen.getByRole('button', { name: 'Add variant' }));
    await waitFor(() => expect(variantApi.create).toHaveBeenCalledWith(expect.objectContaining({
      product_id: 'product-1', title: 'Medium / Blue', sku: 'SHIRT-M-BLU', option_values: { size: 'M', color: 'Blue' }, price_cents: null,
    }), { clientId: undefined }));
    expect(screen.getByText(/SKU SHIRT-M-BLU/)).toBeTruthy();
  });

  test('explains why a variant cannot be added before its product is saved', () => {
    render(<ProductVariantsSection productId={null} canEdit />);
    expect(screen.getByText('Save this physical product before adding variants.')).toBeTruthy();
  });
});
