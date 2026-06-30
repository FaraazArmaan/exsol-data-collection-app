// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiTile } from '../components/KpiTile';

describe('KpiTile', () => {
  it('formats cents as currency and shows the delta', () => {
    render(<KpiTile label="Revenue" value={250000} unit="cents" deltaPct={12.5} />);
    expect(screen.getByText(/2,500/)).toBeInTheDocument();
    expect(screen.getByText(/12.5%/)).toBeInTheDocument();
  });

  it('formats counts as integers and hides delta when null', () => {
    render(<KpiTile label="Sales" value={42} unit="count" deltaPct={null} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
