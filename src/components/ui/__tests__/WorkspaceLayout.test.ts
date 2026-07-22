import { describe, expect, it } from 'vitest';
import { normalizeWorkspaceLayout, orderedWorkspaceItems } from '../WorkspaceLayout';

const definition = {
  namespace: 'booking.tabs',
  tabs: [{ id: 'calendar', label: 'Calendar' }, { id: 'bookings', label: 'Bookings' }, { id: 'services', label: 'Services' }],
  blocks: [{ id: 'planner', label: 'Planner', defaultSize: 'wide' as const }, { id: 'staff', label: 'Staff', defaultSize: 'standard' as const }],
};

describe('workspace layout normalization', () => {
  it('keeps only recognized ids and appends newly required items', () => {
    expect(normalizeWorkspaceLayout(definition, {
      version: 1,
      tabs: ['services', 'unknown', 'calendar'],
      blocks: [{ id: 'staff', size: 'compact' }, { id: 'unknown', size: 'wide' }],
    })).toEqual({
      version: 1,
      tabs: ['services', 'calendar', 'bookings'],
      blocks: [{ id: 'staff', size: 'compact' }, { id: 'planner', size: 'wide' }],
    });
  });

  it('orders permitted items without restoring inaccessible ones', () => {
    const permitted = [{ id: 'calendar' }, { id: 'services' }];
    expect(orderedWorkspaceItems(permitted, ['services', 'bookings', 'calendar']).map((item) => item.id))
      .toEqual(['services', 'calendar']);
  });

  it('restores the approved width when a saved layout uses an unsupported one', () => {
    expect(normalizeWorkspaceLayout({
      namespace: 'workforce.timesheets',
      blocks: [{ id: 'log-entry', label: 'Log entry', defaultSize: 'wide', sizes: ['wide'] }],
    }, { version: 1, blocks: [{ id: 'log-entry', size: 'standard' }] }).blocks)
      .toEqual([{ id: 'log-entry', size: 'wide' }]);
  });
});
