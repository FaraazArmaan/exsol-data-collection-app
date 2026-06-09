/** @vitest-environment jsdom */
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryCombobox } from '../../src/modules/products/workspace/components/CategoryCombobox';
import type { ProductCategory } from '../../src/modules/products/shared/types';

const cats: ProductCategory[] = [
  { id: 'c1', name: 'Beverages',  sort_order: 0, created_at: '', updated_at: '' },
  { id: 'c2', name: 'Snacks',     sort_order: 1, created_at: '', updated_at: '' },
  { id: 'c3', name: 'Vegetables', sort_order: 2, created_at: '', updated_at: '' },
];

function makeOnCreate() {
  return vi.fn(async (name: string): Promise<ProductCategory> => ({
    id: 'new', name, sort_order: 0, created_at: '', updated_at: '',
  }));
}

describe('CategoryCombobox', () => {
  test('shows + Create when query has no exact match and canCreate=true', async () => {
    const user = userEvent.setup();
    render(
      <CategoryCombobox
        value={null}
        categories={cats}
        canCreate={true}
        onSelect={() => {}}
        onCreate={makeOnCreate()}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'Vegan');

    expect(screen.getByText(/Create "Vegan"/)).toBeTruthy();
  });

  test('does NOT show + Create when canCreate=false', async () => {
    const user = userEvent.setup();
    render(
      <CategoryCombobox
        value={null}
        categories={cats}
        canCreate={false}
        onSelect={() => {}}
        onCreate={makeOnCreate()}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'Vegan');

    expect(screen.queryByText(/Create "Vegan"/)).toBeNull();
  });

  test('clicking + Create calls onCreate then onSelect with new id', async () => {
    const user = userEvent.setup();
    const onCreate = makeOnCreate();
    const onSelect = vi.fn();

    render(
      <CategoryCombobox
        value={null}
        categories={cats}
        canCreate={true}
        onSelect={onSelect}
        onCreate={onCreate}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'Vegan');

    const createBtn = screen.getByText(/Create "Vegan"/);
    await user.click(createBtn);

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Vegan'));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new'));
  });

  test('ArrowDown then Enter selects the first filtered category', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <CategoryCombobox
        value={null}
        categories={cats}
        canCreate={true}
        onSelect={onSelect}
        onCreate={makeOnCreate()}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.type(input, 'Veg');
    // First filtered match should be "Vegetables" (c3).
    // ArrowDown moves highlight onto the first filtered option (skipping the
    // Uncategorized row, which sits at index 0).
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('c3');
  });

  test('Escape closes the dropdown', async () => {
    const user = userEvent.setup();
    render(
      <CategoryCombobox
        value={null}
        categories={cats}
        canCreate={true}
        onSelect={() => {}}
        onCreate={makeOnCreate()}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);
    expect(screen.queryByRole('listbox')).not.toBeNull();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
