import { describe, expect, it } from 'vitest';
import { deriveBookingSetup } from '../lib/setup';

describe('deriveBookingSetup', () => {
  it('gives a solo consultant only their availability and booking rules', () => {
    const out = deriveBookingSetup({
      booking_party_mode: 'specific_team_member',
      bookable_kinds: ['appointment'],
      extra_capacity_needs: [],
      availability_source: 'workforce',
    });
    expect(out.visible_sections).toEqual([
      { key: 'team', label: 'Your Availability' },
      { key: 'rules', label: 'Booking Rules' },
    ]);
  });

  it('shows team availability and stations for a salon configuration', () => {
    const out = deriveBookingSetup({
      booking_party_mode: 'any_team_member',
      bookable_kinds: ['appointment'],
      extra_capacity_needs: ['space'],
      availability_source: 'workforce',
      display_labels: { space: 'Stations' },
    });
    expect(out.visible_sections).toEqual([
      { key: 'team', label: 'Team Availability' },
      { key: 'space', label: 'Stations' },
      { key: 'rules', label: 'Booking Rules' },
    ]);
  });

  it('uses client labels for a clinic configuration', () => {
    const out = deriveBookingSetup({
      booking_party_mode: 'specific_team_member',
      bookable_kinds: ['appointment', 'space', 'equipment'],
      extra_capacity_needs: ['space', 'equipment'],
      availability_source: 'workforce',
      display_labels: { team: 'Doctors', space: 'Rooms', equipment: 'Equipment' },
    });
    expect(out.visible_sections).toEqual([
      { key: 'team', label: 'Doctors' },
      { key: 'space', label: 'Rooms' },
      { key: 'equipment', label: 'Equipment' },
      { key: 'rules', label: 'Booking Rules' },
    ]);
  });

  it('supports equipment rental without a team member', () => {
    const out = deriveBookingSetup({
      booking_party_mode: 'nobody_specific',
      bookable_kinds: ['equipment'],
      extra_capacity_needs: [],
      availability_source: 'manual',
      display_labels: { equipment: 'Assets' },
    });
    expect(out.visible_sections).toEqual([
      { key: 'equipment', label: 'Assets' },
      { key: 'rules', label: 'Booking Rules' },
    ]);
    expect(out.reservation_rules.requires_team_member).toBe(false);
  });
});
