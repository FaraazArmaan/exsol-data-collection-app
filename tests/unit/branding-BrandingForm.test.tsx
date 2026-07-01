/** @vitest-environment jsdom */
import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { BrandingForm, type BrandingApi } from '../../src/modules/branding/BrandingForm';
import type { Brand } from '../../src/modules/branding/types';

const base: Brand = { name: 'Acme', logoUrl: null, logoAltUrl: null, faviconUrl: null, appIconUrl: null, socialUrl: null, heroUrls: [], accent: null, theme: 'dark', fontHeading: null, fontBody: null };
afterEach(() => cleanup());

function mkApi(): BrandingApi {
  return {
    uploadImage: vi.fn(async () => ({ key: 'brand/x/logo' })),
    patch: vi.fn(async () => {}),
  };
}

describe('BrandingForm', () => {
  test('renders the four section headings', () => {
    render(<BrandingForm brand={base} api={mkApi()} />);
    expect(screen.getByRole('heading', { name: /logos/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /hero/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /colou?rs? & theme/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /typography/i })).toBeTruthy();
  });

  test('theme toggle patches brand_theme', async () => {
    const api = mkApi();
    render(<BrandingForm brand={base} api={api} />);
    fireEvent.click(screen.getByLabelText(/light theme/i));
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const call = (api.patch as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(call.theme).toBe('light');
  });

  test('accent picker rejects a bad hex (no patch) and accepts a good one', async () => {
    const api = mkApi();
    render(<BrandingForm brand={base} api={api} />);
    const hexInput = screen.getByLabelText(/accent color/i) as HTMLInputElement;
    fireEvent.change(hexInput, { target: { value: 'nothex' } });
    fireEvent.blur(hexInput);
    expect((api.patch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
    fireEvent.change(hexInput, { target: { value: '#3b82f6' } });
    fireEvent.blur(hexInput);
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
  });

  test('font picker lists allowlist families', () => {
    render(<BrandingForm brand={base} api={mkApi()} />);
    const headingSelect = screen.getByLabelText(/heading font/i) as HTMLSelectElement;
    const options = Array.from(headingSelect.options).map((o) => o.value);
    expect(options).toContain('Inter');
    expect(options).toContain('Merriweather');
  });
});
