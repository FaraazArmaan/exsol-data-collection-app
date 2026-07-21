import { useEffect, useState } from 'react';
import { BookingApiError, bookingApi, type BookingPolicy } from '../shared/api';
import { BookingTabs } from './BookingTabs';

interface Props {
  slug: string;
  perms: ReadonlySet<string>;
}

export default function BookingPolicyPage({ slug, perms }: Props) {
  const canEdit = perms.has('booking.employees.edit');
  const [policy, setPolicy] = useState<BookingPolicy | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    setMessage(null);
    bookingApi
      .getPolicy()
      .then(setPolicy)
      .catch((error) =>
        setMessage(
          error instanceof BookingApiError
            ? `Could not load booking rules (${error.code}).`
            : 'Could not load booking rules.',
        ),
      );
  }, [loadAttempt]);

  if (!policy) {
    return (
      <div className="page page-readable booking-vendor">
        <BookingTabs slug={slug} perms={perms} />
        <h1 className="page-title">Booking Rules</h1>
        {message ? (
          <div className="card">
            <p className="error">{message}</p>
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
  const update = <K extends keyof BookingPolicy>(key: K, value: BookingPolicy[K]) =>
    setPolicy((current) => (current ? { ...current, [key]: value } : current));
  const number = (key: keyof BookingPolicy) => (event: React.ChangeEvent<HTMLInputElement>) =>
    update(key, Number(event.target.value));
  async function save() {
    const currentPolicy = policy!;
    setSaving(true);
    setMessage(null);
    try {
      const { version: _, ...body } = currentPolicy;
      const updated = await bookingApi.putPolicy(body);
      setPolicy(updated);
      setMessage(`Booking rules saved. New visits use version ${updated.version}.`);
    } catch (error) {
      setMessage(
        error instanceof BookingApiError
          ? `Could not save (${error.code}).`
          : 'Could not save booking rules.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page page-readable booking-vendor">
      <BookingTabs slug={slug} perms={perms} />
      <h1 className="page-title">Booking Rules</h1>
      <p className="muted">
        Changes apply to new visits only. Existing visits keep the rules accepted when they were
        created.
      </p>
      <div className="booking-policy-grid">
        <section className="card">
          <h2 className="section-title">Customer changes</h2>
        <label>
          Cancellation cutoff (minutes before start)
          <input
            type="number"
            min={0}
            value={policy.cancel_cutoff_min}
            disabled={!canEdit}
            onChange={number('cancel_cutoff_min')}
          />
        </label>
        <label>
          Reschedule cutoff (minutes before start)
          <input
            type="number"
            min={0}
            value={policy.reschedule_cutoff_min}
            disabled={!canEdit}
            onChange={number('reschedule_cutoff_min')}
          />
        </label>
        <label>
          Customer reschedule limit
          <input
            type="number"
            min={0}
            max={20}
            value={policy.max_customer_reschedules}
            disabled={!canEdit}
            onChange={number('max_customer_reschedules')}
          />
        </label>
        <label>
          Late reschedule handling
          <select
            value={policy.late_reschedule_action}
            disabled={!canEdit}
            onChange={(event) =>
              update(
                'late_reschedule_action',
                event.target.value as BookingPolicy['late_reschedule_action'],
              )
            }
          >
            <option value="disallow">Disallow</option>
            <option value="staff_approval">Require staff approval</option>
          </select>
        </label>
        <label>
          Late reschedule fee (paise)
          <input
            type="number"
            min={0}
            value={policy.late_reschedule_fee_cents}
            disabled={!canEdit}
            onChange={number('late_reschedule_fee_cents')}
          />
        </label>
        </section>
        <section className="card">
          <h2 className="section-title">Attendance and settlement</h2>
        <label>
          Late-arrival grace (minutes)
          <input
            type="number"
            min={0}
            value={policy.late_arrival_grace_min}
            disabled={!canEdit}
            onChange={number('late_arrival_grace_min')}
          />
        </label>
        <label>
          No-show outcome
          <select
            value={policy.no_show_outcome}
            disabled={!canEdit}
            onChange={(event) =>
              update('no_show_outcome', event.target.value as BookingPolicy['no_show_outcome'])
            }
          >
            <option value="staff_review">Staff review</option>
            <option value="automatic_no_show">Automatic no-show</option>
          </select>
        </label>
        <label>
          Cancellation settlement
          <select
            value={policy.cancellation_settlement}
            disabled={!canEdit}
            onChange={(event) =>
              update(
                'cancellation_settlement',
                event.target.value as BookingPolicy['cancellation_settlement'],
              )
            }
          >
            <option value="forfeit_deposit">Forfeit deposit</option>
            <option value="refund_deposit">Refund deposit</option>
            <option value="credit_deposit">Credit deposit</option>
          </select>
        </label>
        <label>
          Deposit rule
          <select
            value={policy.deposit_requirement}
            disabled={!canEdit}
            onChange={(event) =>
              update(
                'deposit_requirement',
                event.target.value as BookingPolicy['deposit_requirement'],
              )
            }
          >
            <option value="service_defined">Use each service’s setting</option>
            <option value="none">Never require a deposit</option>
            <option value="required">Require a deposit</option>
          </select>
        </label>
        <p className="muted">
          Payment collection, fees, refunds and credits are recorded by the Payments module when it
          is integrated.
        </p>
        </section>
      </div>
      {message ? <p className="muted">{message}</p> : null}
      {canEdit ? (
        <button className="btn btn-primary booking-policy-save" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save booking rules'}
        </button>
      ) : (
        <p className="muted">You have read-only access to booking rules.</p>
      )}
    </div>
  );
}
