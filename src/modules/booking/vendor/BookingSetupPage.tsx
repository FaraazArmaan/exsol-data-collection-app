import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  bookingApi,
  BookingApiError,
  type AvailabilitySource,
  type BookableKind,
  type BookingPartyMode,
  type BookingSetup,
  type ExtraCapacityNeed,
} from '../shared/api';
import { BookingTabs } from './BookingTabs';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

interface Draft {
  booking_party_mode: BookingPartyMode;
  bookable_kinds: BookableKind[];
  extra_capacity_needs: ExtraCapacityNeed[];
  availability_source: AvailabilitySource;
  display_labels: Partial<BookingSetup['display_labels']>;
}

const STEPS = ['Who books', 'What is booked', 'What is needed', 'Availability', 'Names'];

function draftFrom(setup: BookingSetup): Draft {
  return {
    booking_party_mode: setup.booking_party_mode,
    bookable_kinds: setup.bookable_kinds,
    extra_capacity_needs: setup.extra_capacity_needs,
    availability_source: setup.availability_source,
    display_labels: setup.display_labels,
  };
}

function toggle<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

export default function BookingSetupPage({ slug, perms }: Props) {
  const canEdit = perms.has('booking.employees.edit');
  const [setup, setSetup] = useState<BookingSetup | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    setError(null);
    bookingApi
      .getSetup()
      .then((value) => {
        setSetup(value);
        setDraft(draftFrom(value));
        setStep(value.completed_at ? STEPS.length : 0);
      })
      .catch((e) => setError(e instanceof BookingApiError ? e.code : 'load_error'));
  }, [loadAttempt]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const display_labels = Object.fromEntries(
        Object.entries(draft.display_labels).filter(([, value]) => value?.trim()),
      );
      const saved = await bookingApi.putSetup({ ...draft, display_labels });
      setSetup(saved);
      setDraft(draftFrom(saved));
      setStep(STEPS.length);
    } catch (e) {
      setError(e instanceof BookingApiError ? e.code : 'save_error');
    } finally {
      setSaving(false);
    }
  }

  if (!setup || !draft) {
    return (
      <div className="page booking-vendor">
        <BookingTabs slug={slug} perms={perms} />
        <h1 className="page-title">Booking Setup</h1>
        {error ? (
          <div className="card">
            <p className="error">Couldn’t load Booking Setup ({error}).</p>
            <button className="btn btn-secondary" onClick={() => setLoadAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : (
          <div className="muted">Loading…</div>
        )}
      </div>
    );
  }
  const needsTeam = draft.booking_party_mode !== 'nobody_specific';
  const needsSpace =
    draft.bookable_kinds.includes('space') || draft.extra_capacity_needs.includes('space');
  const needsEquipment =
    draft.bookable_kinds.includes('equipment') || draft.extra_capacity_needs.includes('equipment');
  const disabled = !canEdit || saving;

  if (step === STEPS.length) {
    return (
      <div className="page booking-vendor">
        <BookingTabs slug={slug} perms={perms} />
        <h1 className="page-title">Booking Setup</h1>
        <div className="card">
          <h2 className="section-title">Your booking setup is ready</h2>
          <p className="muted">
            Customers will see booking choices based on the setup below. Internal technical names
            are never shown.
          </p>
          <ul className="booking-list-plain">
            {setup.visible_sections.map((section) => (
              <li key={section.key}>{section.label}</li>
            ))}
          </ul>
          <p className="muted">
            Availability:{' '}
            {setup.availability_source === 'workforce'
              ? 'Workforce shifts and leave'
              : 'Manual business hours'}
          </p>
          {setup.availability_source === 'workforce' &&
          setup.booking_party_mode !== 'nobody_specific' ? (
            <p className="muted">
              Before customers can see times, create active shifts for each bookable team member in{' '}
              <Link to={`/c/${slug}/workforce`}>Staff &amp; Schedule</Link>. Booking business hours
              also need to cover those shifts.
            </p>
          ) : null}
          <p className="muted">
            Turn customer booking on or off in{' '}
            <Link to={`/c/${slug}/pos/settings`}>Storefront</Link>. It appears beside online
            ordering because both are features of the same public business site.
          </p>
          {canEdit ? (
            <button className="btn btn-primary" onClick={() => setStep(0)}>
              Edit Booking Setup
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="page booking-vendor">
      <BookingTabs slug={slug} perms={perms} />
      <h1 className="page-title">Booking Setup</h1>
      <p className="muted">
        Step {step + 1} of {STEPS.length} · {STEPS[step]}
      </p>
      <div className="card booking-form">
        {step === 0 ? (
          <>
            <h2 className="section-title">Who do customers book with?</h2>
            {(
              [
                ['specific_team_member', 'A specific team member'],
                ['any_team_member', 'Any available team member'],
                ['nobody_specific', 'Nobody specific, just a time or place'],
              ] as Array<[BookingPartyMode, string]>
            ).map(([value, label]) => (
              <label key={value} className="booking-consent">
                <input
                  type="radio"
                  name="party"
                  checked={draft.booking_party_mode === value}
                  disabled={disabled}
                  onChange={() =>
                    setDraft({
                      ...draft,
                      booking_party_mode: value,
                      availability_source:
                        value === 'nobody_specific' ? draft.availability_source : 'workforce',
                    })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h2 className="section-title">What can be booked?</h2>
            {(
              [
                ['appointment', 'Appointments'],
                ['space', 'Rooms or spaces'],
                ['equipment', 'Equipment or assets'],
              ] as Array<[BookableKind, string]>
            ).map(([value, label]) => (
              <label key={value} className="booking-consent">
                <input
                  type="checkbox"
                  checked={draft.bookable_kinds.includes(value)}
                  disabled={disabled}
                  onChange={() =>
                    setDraft({ ...draft, bookable_kinds: toggle(draft.bookable_kinds, value) })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
            {draft.bookable_kinds.length === 0 ? (
              <p className="error">Choose at least one option.</p>
            ) : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2 className="section-title">
              Does each booking need anything besides a team member?
            </h2>
            <label className="booking-consent">
              <input
                type="checkbox"
                checked={draft.extra_capacity_needs.includes('space')}
                disabled={disabled}
                onChange={() =>
                  setDraft({
                    ...draft,
                    extra_capacity_needs: toggle(draft.extra_capacity_needs, 'space'),
                  })
                }
              />
              <span>A room or space</span>
            </label>
            <label className="booking-consent">
              <input
                type="checkbox"
                checked={draft.extra_capacity_needs.includes('equipment')}
                disabled={disabled}
                onChange={() =>
                  setDraft({
                    ...draft,
                    extra_capacity_needs: toggle(draft.extra_capacity_needs, 'equipment'),
                  })
                }
              />
              <span>Equipment</span>
            </label>
            {!needsSpace && !needsEquipment ? (
              <p className="muted">No, a team member or time/place is enough.</p>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2 className="section-title">Where does availability come from?</h2>
            <label className="booking-consent">
              <input
                type="radio"
                name="availability"
                checked={draft.availability_source === 'workforce'}
                disabled={disabled}
                onChange={() => setDraft({ ...draft, availability_source: 'workforce' })}
              />
              <span>Workforce shifts and leave</span>
            </label>
            <label className="booking-consent">
              <input
                type="radio"
                name="availability"
                checked={draft.availability_source === 'manual'}
                disabled={disabled || needsTeam}
                onChange={() => setDraft({ ...draft, availability_source: 'manual' })}
              />
              <span>Manual business hours for now</span>
            </label>
            {needsTeam ? (
              <p className="muted">
                Team-member booking always uses Workforce shifts and approved leave.
              </p>
            ) : null}
          </>
        ) : null}

        {step === 4 ? (
          <>
            <h2 className="section-title">Use names your team understands</h2>
            <p className="muted">
              These labels are shown in your workspace instead of technical terminology.
            </p>
            {needsTeam ? (
              <label>
                Team label
                <input
                  value={draft.display_labels.team ?? ''}
                  disabled={disabled}
                  placeholder={
                    draft.booking_party_mode === 'specific_team_member'
                      ? 'Your Availability'
                      : 'Team Availability'
                  }
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      display_labels: { ...draft.display_labels, team: e.target.value },
                    })
                  }
                />
              </label>
            ) : null}
            {needsSpace ? (
              <label>
                Room or space label
                <input
                  value={draft.display_labels.space ?? ''}
                  disabled={disabled}
                  placeholder="Rooms & Spaces"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      display_labels: { ...draft.display_labels, space: e.target.value },
                    })
                  }
                />
              </label>
            ) : null}
            {needsEquipment ? (
              <label>
                Equipment label
                <input
                  value={draft.display_labels.equipment ?? ''}
                  disabled={disabled}
                  placeholder="Equipment"
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      display_labels: { ...draft.display_labels, equipment: e.target.value },
                    })
                  }
                />
              </label>
            ) : null}
            <p className="muted">
              Service setup will use “This service can be performed by…”, “This service needs…”, and
              “This booking uses…”.
            </p>
          </>
        ) : null}

        {error ? <p className="error">Couldn’t save ({error}).</p> : null}
        <div className="booking-form-inline">
          {step > 0 ? (
            <button className="btn btn-ghost" onClick={() => setStep(step - 1)} disabled={saving}>
              Back
            </button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <button
              className="btn btn-primary"
              onClick={() => setStep(step + 1)}
              disabled={disabled || (step === 1 && draft.bookable_kinds.length === 0)}
            >
              Next
            </button>
          ) : (
            <button className="btn btn-primary" onClick={save} disabled={disabled}>
              {saving ? 'Saving…' : 'Finish setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
