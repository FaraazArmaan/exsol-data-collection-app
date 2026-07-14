# Booking V1 Product Contract

## Identity

The customer-facing product is **Appointments & Reservations**. It is a general-purpose system for
businesses that reserve time, people, places, or equipment. The existing `saloon-booking` product
key remains unchanged because enabled workspaces and product dependencies already reference it.

## V1 outcome

A workspace can configure how its customers book, publish valid availability, accept a visit with
one or more services, prevent capacity conflicts, allow policy-compliant changes, collect or record
payment, notify the customer, and retain an auditable appointment history.

## Client-facing language

`resource` is an internal database/API term only. Clients never see a generic Resources page, tab,
or label. They start in **Booking Setup**, which asks:

1. Who do customers book with: a specific team member, any available team member, or nobody
   specific?
2. What can be booked: appointments, rooms/spaces, equipment/assets, or a combination?
3. Does a booking need anything besides a team member: nothing, a room/space, equipment, or both?
4. Where does availability come from: Workforce shifts and leave, or manual business hours for now?
5. For each service: "This service can be performed by...", "This service needs...", and "This booking
   uses...".

The answers create internal `booking_resources` records and reservation rules. They also determine
the UI labels: for example, Your Availability, Team Availability, Doctors, Stylists, Rooms, Stations,
Assets, Vehicles, Equipment, and Booking Rules.

## Capacity and Workforce

An appointment may reserve several internal capacity records, such as a doctor and room, a stylist
and station, or an equipment asset. When a booking involves a team member, Workforce is the
authoritative source for that person's shifts, approved leave, and active status. Booking must not
offer a team member outside those intervals. Manual business hours are only the configured fallback
for non-team capacity or an explicit temporary setup choice.

## Visits and services

The customer creates one **visit**, which may contain multiple service lines. Lines are sequential by
default, such as haircut then beard trim, and share one confirmation, customer, policy snapshot, and
payment balance. Parallel services are supported only where a workspace configures them explicitly.

## Customer policy

Each workspace configures deposit/payment rules, cancellation and reschedule cutoffs, allowed
reschedule count, late-arrival grace period, no-show outcome, refund/credit handling, and late-change
fees. The default is a configurable free-change window, commonly 24 or 48 hours. After its cutoff,
the client either requires staff approval or applies its configured fee/deposit rule. Overrides need
an authorized actor and recorded reason. Existing visits retain the policy snapshot they accepted.

## Payment and notifications

Appointment status and payment status are separate. Pay-at-venue visits can be confirmed while
unpaid; payment completes through a verified Payments-module event or an authorized staff cash
receipt. Online payments remain disabled until the Payments module supplies idempotent payment
records and signed webhook verification.

Default operational behavior:

- A payment-required hold expires after 15 minutes according to workspace policy.
- Payment-provider events are idempotent; late events go to staff reconciliation and never silently
  reopen a now-taken slot.
- Notification jobs retry with backoff for up to 24 hours; permanent failure creates a staff action
  and does not cancel the booking.
- Calendar-sync failure leaves the ExSol appointment authoritative, retries safely, and is visible
  to staff.

## Privacy and account access

The module follows a global privacy baseline: collect only booking/transaction data needed for the
stated purpose; keep transactional messages separate from marketing consent; enforce tenant and
role access controls; retain audit history; support correction, export, deletion, and documented
retention/anonymisation jobs. Sensitive clinical or medical notes are outside generic Booking until a
sector-specific privacy design is approved.

A guest manage link may display a booking summary. Cancel, reschedule, contact changes, and
payment-link actions require a rate-limited, single-use OTP sent to the verified email or phone. The
OTP expires after 10 minutes. Relevant manage sessions are revoked after cancellation or material
change; logged-in customers use their normal account.

## Explicit non-goals for the first build

- Live online payment collection before the shared Payments contract is complete.
- Sector-specific clinical records or compliance workflows.
- Recurring visits, waitlists, memberships, packages, coupons, group capacity, or external-calendar
  sync beyond the durable integration seam.
- Renaming the persisted `saloon-booking` key without a dedicated compatibility migration.

## Engineering gates

No Booking data migration or capacity-management UI may be designed until the editable Booking Setup
model, display-label model, Workforce availability contract, and shared reservation-validation test
matrix are approved. Every create and reschedule path must use the same server-side reservation
policy and the database must remain the final double-booking authority.
