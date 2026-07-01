/** @vitest-environment jsdom */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { BrandHero } from '../../src/modules/branding/BrandHero';

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } } as unknown as MediaQueryList));
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('BrandHero', () => {
  test('renders nothing for empty', () => {
    const { container } = render(<BrandHero heroUrls={[]} />);
    expect(container.firstChild).toBeNull();
  });

  test('single slide: image but no dots', () => {
    const { container } = render(<BrandHero heroUrls={['/a']} />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('.brand-hero-dot')).toBeNull();
  });

  test('multi-slide auto-rotates on the interval', () => {
    const { container } = render(<BrandHero heroUrls={['/a', '/b']} interval={5000} />);
    const imgSrc = () => container.querySelector('img')?.getAttribute('src');
    expect(imgSrc()).toBe('/a');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(imgSrc()).toBe('/b');
  });

  test('next chevron advances', () => {
    const { container, getByLabelText } = render(<BrandHero heroUrls={['/a', '/b']} />);
    fireEvent.click(getByLabelText(/next/i));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/b');
  });
});
