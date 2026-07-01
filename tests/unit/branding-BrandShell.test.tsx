/** @vitest-environment jsdom */
import { describe, expect, test, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { BrandShell } from '../../src/modules/branding/BrandShell';
import type { Brand } from '../../src/modules/branding/types';

const base: Brand = { name: 'Acme', logoUrl: null, logoAltUrl: null, faviconUrl: null, appIconUrl: null, socialUrl: null, heroUrls: [], accent: null, theme: 'dark', fontHeading: null, fontBody: null };

afterEach(() => {
  cleanup();
  document.querySelectorAll('link[data-brand-shell="1"]').forEach((el) => el.remove());
});

describe('BrandShell', () => {
  test('sets data-theme from brand', () => {
    const { container } = render(<BrandShell brand={{ ...base, theme: 'light' }}>x</BrandShell>);
    expect(container.querySelector('.brand-shell')?.getAttribute('data-theme')).toBe('light');
  });

  test('applies inline accent custom props when accent set', () => {
    const { container } = render(<BrandShell brand={{ ...base, accent: '#3b82f6' }}>x</BrandShell>);
    const el = container.querySelector('.brand-shell') as HTMLElement;
    expect(el.style.getPropertyValue('--accent')).toBe('#3b82f6');
    expect(el.style.getPropertyValue('--text-on-accent')).toBe('#ffffff');
  });

  test('applies inline font custom props when families set', () => {
    const { container } = render(<BrandShell brand={{ ...base, fontHeading: 'Inter', fontBody: 'Lora' }}>x</BrandShell>);
    const el = container.querySelector('.brand-shell') as HTMLElement;
    expect(el.style.getPropertyValue('--brand-font-heading')).toContain('Inter');
    expect(el.style.getPropertyValue('--brand-font-body')).toContain('Lora');
  });

  test('renders logo img when logoUrl set, else the name', () => {
    const { container, rerender } = render(<BrandShell brand={base}>x</BrandShell>);
    expect(container.querySelector('.brand-logo')).toBeNull();
    expect(container.textContent).toContain('Acme');
    rerender(<BrandShell brand={{ ...base, logoUrl: '/img/logo' }}>x</BrandShell>);
    expect(container.querySelector('img.brand-logo')?.getAttribute('src')).toBe('/img/logo');
  });

  test('injects favicon + apple-touch-icon links (not fonts) on mount', async () => {
    render(<BrandShell brand={{ ...base, faviconUrl: '/img/fav', appIconUrl: '/img/app' }}>x</BrandShell>);
    await Promise.resolve();
    expect(document.querySelector('link[rel="icon"][data-brand-shell="1"]')?.getAttribute('href')).toBe('/img/fav');
    expect(document.querySelector('link[rel="apple-touch-icon"][data-brand-shell="1"]')?.getAttribute('href')).toBe('/img/app');
    expect(document.querySelector('link[rel="stylesheet"][data-brand-shell="1"]')).toBeNull();
  });
});
