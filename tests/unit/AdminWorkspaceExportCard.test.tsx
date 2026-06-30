/** @vitest-environment jsdom */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminWorkspaceExportCard from '../../src/modules/ams/components/settings/AdminWorkspaceExportCard';

const CLIENT_ID = 'c-1234';
const SLUG = 'acme';

beforeEach(() => {
  global.fetch = vi.fn(async () => new Response('{}', {
    status: 200, headers: { 'content-type': 'application/json' },
  })) as never;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('AdminWorkspaceExportCard — rendering', () => {
  test('renders the Workspace backup heading', () => {
    render(<AdminWorkspaceExportCard clientId={CLIENT_ID} slug={SLUG} />);
    expect(screen.getByText(/workspace backup/i)).toBeTruthy();
  });

  test('shows Download JSON and Download ZIP buttons', () => {
    render(<AdminWorkspaceExportCard clientId={CLIENT_ID} slug={SLUG} />);
    expect(screen.getByRole('button', { name: /download json/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /download zip/i })).toBeTruthy();
  });
});

describe('AdminWorkspaceExportCard — download click', () => {
  test('clicking "Download JSON" calls fetch with ?format=json&client=<clientId>', async () => {
    const f = vi.fn(async () => new Response('{}', {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    global.fetch = f as never;
    render(<AdminWorkspaceExportCard clientId={CLIENT_ID} slug={SLUG} />);
    fireEvent.click(screen.getByRole('button', { name: /download json/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(f).toHaveBeenCalledTimes(1);
    const firstCallArg = (f.mock.calls as unknown as [string, ...unknown[]][])[0]?.[0] ?? '';
    expect((firstCallArg as string).includes('/api/workspace-export?format=json')).toBe(true);
    expect((firstCallArg as string).includes(`client=${CLIENT_ID}`)).toBe(true);
  });

  test('clicking "Download ZIP" calls fetch with ?format=zip&client=<clientId>', async () => {
    const f = vi.fn(async () => new Response('{}', {
      status: 200, headers: { 'content-type': 'application/zip' },
    }));
    global.fetch = f as never;
    render(<AdminWorkspaceExportCard clientId={CLIENT_ID} slug={SLUG} />);
    fireEvent.click(screen.getByRole('button', { name: /download zip/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(f).toHaveBeenCalledTimes(1);
    const firstCallArg = (f.mock.calls as unknown as [string, ...unknown[]][])[0]?.[0] ?? '';
    expect((firstCallArg as string).includes('/api/workspace-export?format=zip')).toBe(true);
    expect((firstCallArg as string).includes(`client=${CLIENT_ID}`)).toBe(true);
  });
});

describe('AdminWorkspaceExportCard — 413 error', () => {
  test('413 response surfaces a human-readable error message', async () => {
    global.fetch = vi.fn(async () => new Response('too large', { status: 413 })) as never;
    render(<AdminWorkspaceExportCard clientId={CLIENT_ID} slug={SLUG} />);
    fireEvent.click(screen.getByRole('button', { name: /download json/i }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('alert').textContent).toMatch(/too large/i);
  });
});
