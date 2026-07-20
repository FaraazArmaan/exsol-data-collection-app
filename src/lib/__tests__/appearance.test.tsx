// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { AppearanceProvider, useAppearance } from '../appearance';

describe('AppearanceProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('restores an explicit appearance override onto the document root', async () => {
    window.localStorage.setItem('exsol.appearance', 'light');
    renderHook(() => useAppearance(), { wrapper: AppearanceProvider });

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  });

  it('returns to system appearance by clearing the root override and storage', async () => {
    const { result } = renderHook(() => useAppearance(), { wrapper: AppearanceProvider });
    act(() => result.current.setAppearance('dark'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));

    act(() => result.current.setAppearance('system'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeUndefined());
    expect(window.localStorage.getItem('exsol.appearance')).toBeNull();
  });
});
