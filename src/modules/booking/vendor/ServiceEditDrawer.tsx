import { useState } from 'react';
import { bookingApi, type VendorService, type VendorResource, type PaymentMode } from '../shared/api';
import { ONLINE_PAYMENTS_ENABLED } from '../config';
import { Button } from '../../../components/ui/Button';
import { Field, Input, Select } from '../../../components/ui/Field';
import { InlineNotice } from '../../../components/ui/Feedback';
import { Overlay } from '../../../components/ui/Overlay';

interface Props {
  service?: VendorService;
  resources: VendorResource[];
  onClose: () => void;
  onSaved: () => void;
}

export function ServiceEditDrawer({ service, resources, onClose, onSaved }: Props) {
  const isNew = !service;
  const [name, setName] = useState(service?.name ?? '');
  const [duration, setDuration] = useState(service?.duration_min ?? 30);
  const [price, setPrice] = useState(service?.price_cents ?? 0);
  const [buffer, setBuffer] = useState(service?.buffer_min ?? 0);
  const [mode, setMode] = useState<PaymentMode>(service?.payment_mode ?? 'pay_at_venue');
  const [deposit, setDeposit] = useState(service?.deposit_cents ?? 0);
  const [eligible, setEligible] = useState<string[]>(service?.eligible_resource_ids ?? []);
  const [resourceScope, setResourceScope] = useState<'all' | 'selected'>(
    service?.eligible_resource_ids?.length ? 'selected' : 'all',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const values = {
      name: name.trim(),
      duration_min: duration,
      price_cents: price,
      buffer_min: buffer,
      eligible_resource_ids: resourceScope === 'selected' ? eligible : [],
      ...(ONLINE_PAYMENTS_ENABLED || isNew
        ? { payment_mode: mode, deposit_cents: mode === 'deposit' ? deposit : null }
        : {}),
    };
    try {
      if (service) await bookingApi.patchService(service.id, values);
      else await bookingApi.createService(values);
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.code ?? 'save_error');
      setBusy(false);
    }
  }

  return (
    <Overlay
      open
      title={isNew ? 'Add service' : 'Edit service'}
      description={isNew ? 'Create a bookable service for this workspace.' : 'Update this bookable service.'}
      variant="drawer"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} loadingLabel={isNew ? 'Adding service…' : 'Saving service…'} onClick={save} disabled={!name.trim() || (resourceScope === 'selected' && eligible.length === 0)}>
            {isNew ? 'Add service' : 'Save service'}
          </Button>
        </>
      }
    >
      <div className="ui-form-grid ui-form-grid--two">
        <div className="ui-form-grid__full"><Field label="Name" required>{(props) => <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />}</Field></div>
        <Field label="Duration (minutes)">{(props) => <Input {...props} type="number" min={5} step={5} value={duration} onChange={(event) => setDuration(Number(event.target.value))} />}</Field>
        <Field label="Price (₹)">{(props) => <Input {...props} type="number" min={0} value={price / 100} onChange={(event) => setPrice(Math.round(Number(event.target.value) * 100))} />}</Field>
        {!isNew ? <div className="ui-form-grid__full"><Field label="Buffer after (minutes)">{(props) => <Input {...props} type="number" min={0} value={buffer} onChange={(event) => setBuffer(Number(event.target.value))} />}</Field></div> : null}
        {ONLINE_PAYMENTS_ENABLED ? <div className="ui-form-grid__full"><Field label="Payment">{(props) => <Select {...props} value={mode} onChange={(event) => setMode(event.target.value as PaymentMode)}><option value="pay_at_venue">Pay at venue</option><option value="deposit">Deposit</option><option value="full_upfront">Full upfront</option></Select>}</Field></div> : null}
        {ONLINE_PAYMENTS_ENABLED && mode === 'deposit' ? <div className="ui-form-grid__full"><Field label="Deposit (₹)">{(props) => <Input {...props} type="number" min={0} value={deposit / 100} onChange={(event) => setDeposit(Math.round(Number(event.target.value) * 100))} />}</Field></div> : null}
        {resources.length ? <fieldset className="ui-choice-group ui-form-grid__full">
          <legend>Eligible resources</legend>
          <div className="ui-choice-switch" aria-label="Eligible resource scope">
            <Button type="button" size="compact" variant={resourceScope === 'all' ? 'primary' : 'secondary'} aria-pressed={resourceScope === 'all'} onClick={() => setResourceScope('all')}>All resources</Button>
            <Button type="button" size="compact" variant={resourceScope === 'selected' ? 'primary' : 'secondary'} aria-pressed={resourceScope === 'selected'} onClick={() => setResourceScope('selected')}>Choose resources</Button>
          </div>
          {resourceScope === 'all' ? <p className="muted">This service can be booked with any available resource.</p> : <div className="ui-choice-grid">{resources.map((resource) => {
            const selected = eligible.includes(resource.id);
            return <Button key={resource.id} type="button" size="compact" variant={selected ? 'primary' : 'secondary'} aria-pressed={selected} onClick={() => setEligible((current) => selected ? current.filter((id) => id !== resource.id) : [...current, resource.id])}>{selected ? '✓ ' : ''}{resource.name}</Button>;
          })}</div>}
        </fieldset> : null}
        {error ? <div className="ui-form-grid__full"><InlineNotice tone="danger" title={`Couldn’t ${isNew ? 'add' : 'save'} this service.`}>{error}</InlineNotice></div> : null}
      </div>
    </Overlay>
  );
}
