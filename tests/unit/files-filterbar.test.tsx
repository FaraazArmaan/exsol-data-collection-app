/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { FilterBar } from '../../src/modules/files/shared/components/FilterBar';

describe('FilterBar search + sort', () => {
  test('typing in search calls onSearchChange', () => {
    const onSearch = vi.fn();
    render(<FilterBar selected={[]} onChange={() => {}} search="" onSearchChange={onSearch} sort="newest" onSortChange={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'invoice' } });
    expect(onSearch).toHaveBeenCalledWith('invoice');
  });

  test('changing sort calls onSortChange', () => {
    const onSort = vi.fn();
    render(<FilterBar selected={[]} onChange={() => {}} search="" onSearchChange={() => {}} sort="newest" onSortChange={onSort} />);
    fireEvent.change(screen.getByLabelText(/sort/i), { target: { value: 'name' } });
    expect(onSort).toHaveBeenCalledWith('name');
  });

  test('toggling a category chip calls onChange', () => {
    const onChange = vi.fn();
    render(<FilterBar selected={[]} onChange={onChange} search="" onSearchChange={() => {}} sort="newest" onSortChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /HR & Payroll/i }));
    expect(onChange).toHaveBeenCalledWith(['hr_payroll']);
  });
});
