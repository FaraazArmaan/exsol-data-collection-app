export type BookingPartyMode = 'specific_team_member' | 'any_team_member' | 'nobody_specific';
export type BookableKind = 'appointment' | 'space' | 'equipment';
export type ExtraCapacityNeed = 'space' | 'equipment';
export type AvailabilitySource = 'workforce' | 'manual';

export interface BookingDisplayLabels {
  team?: string;
  space?: string;
  equipment?: string;
}

export interface BookingSetupInput {
  booking_party_mode: BookingPartyMode;
  bookable_kinds: BookableKind[];
  extra_capacity_needs: ExtraCapacityNeed[];
  availability_source: AvailabilitySource;
  display_labels?: BookingDisplayLabels;
}

export function usesWorkforceAvailability(
  setup: Pick<BookingSetupInput, 'booking_party_mode' | 'availability_source'> | undefined,
): boolean {
  return (
    !!setup &&
    setup.availability_source === 'workforce' &&
    setup.booking_party_mode !== 'nobody_specific'
  );
}

export function deriveBookingSetup(input: BookingSetupInput) {
  const needsTeam = input.booking_party_mode !== 'nobody_specific';
  const needsSpace =
    input.bookable_kinds.includes('space') || input.extra_capacity_needs.includes('space');
  const needsEquipment =
    input.bookable_kinds.includes('equipment') || input.extra_capacity_needs.includes('equipment');
  const labels = {
    team:
      input.display_labels?.team ??
      (input.booking_party_mode === 'specific_team_member'
        ? 'Your Availability'
        : 'Team Availability'),
    space: input.display_labels?.space ?? 'Rooms & Spaces',
    equipment: input.display_labels?.equipment ?? 'Equipment',
  };

  return {
    display_labels: labels,
    reservation_rules: {
      requires_team_member: needsTeam,
      allows_any_team_member: input.booking_party_mode === 'any_team_member',
      requires_space: needsSpace,
      requires_equipment: needsEquipment,
      availability_source: input.availability_source,
    },
    visible_sections: [
      ...(needsTeam ? [{ key: 'team', label: labels.team }] : []),
      ...(needsSpace ? [{ key: 'space', label: labels.space }] : []),
      ...(needsEquipment ? [{ key: 'equipment', label: labels.equipment }] : []),
      { key: 'rules', label: 'Booking Rules' },
    ],
  };
}
