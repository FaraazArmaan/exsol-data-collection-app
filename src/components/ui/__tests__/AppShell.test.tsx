// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppShell } from '../AppShell';

describe('AppShell', () => {
  it('composes supplied navigation, content, and an optional task-navigation landmark without owning their data', () => {
    render(<AppShell navigation={<aside>Registry navigation</aside>} mobileNavigation={<a href="/queue">Queue</a>}>Workspace content</AppShell>);
    expect(screen.getByText('Registry navigation')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Workspace content');
    expect(screen.getByRole('navigation', { name: 'Task navigation' })).toHaveTextContent('Queue');
  });

  it('opens the mobile navigation drawer and returns focus after Escape', () => {
    render(<AppShell navigation={<aside><a href="/dashboard">Dashboard</a></aside>}>Workspace content</AppShell>);
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

});
