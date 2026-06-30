/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { QuotaMeter } from '../../src/modules/files/shared/components/QuotaMeter';
import * as api from '../../src/modules/files/shared/api';

describe('QuotaMeter', () => {
  beforeEach(() => vi.restoreAllMocks());

  test('renders used and limit in GB', async () => {
    vi.spyOn(api, 'getQuota').mockResolvedValue({ byte_limit: 5368709120, bytes_used: 1073741824 });
    render(<QuotaMeter clientId="c1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText(/1\.0 GB \/ 5\.0 GB/)).toBeInTheDocument());
  });

  test('shows over-quota state at ≥100%', async () => {
    vi.spyOn(api, 'getQuota').mockResolvedValue({ byte_limit: 100, bytes_used: 100 });
    render(<QuotaMeter clientId="c1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100'));
  });
});
