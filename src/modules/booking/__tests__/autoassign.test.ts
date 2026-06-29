import { describe, it, expect } from 'vitest';
import { pickLeastBusy } from '../lib/autoassign';

describe('pickLeastBusy', () => {
  it('picks the resource with the fewest bookings today', () => {
    expect(pickLeastBusy([
      { id: 'b', bookingsToday: 3 }, { id: 'a', bookingsToday: 1 }, { id: 'c', bookingsToday: 2 },
    ])).toBe('a');
  });
  it('breaks ties by ascending id', () => {
    expect(pickLeastBusy([
      { id: 'z', bookingsToday: 2 }, { id: 'a', bookingsToday: 2 },
    ])).toBe('a');
  });
  it('returns null when there are no candidates', () => {
    expect(pickLeastBusy([])).toBeNull();
  });
});
