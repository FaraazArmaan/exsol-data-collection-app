import { FormEvent, useEffect, useState } from 'react';
import { PaymentsApiError, paymentsApi } from '../shared/api';
import type { PaymentProviderConnection } from '../shared/types';
import { Button } from '../../../components/ui/Button';
import { ErrorState, InlineNotice, LoadingState } from '../../../components/ui/Feedback';
import { Field, Input } from '../../../components/ui/Field';

export default function PaymentProviderSettingsCard() {
  const [connection, setConnection] = useState<PaymentProviderConnection | null>(null);
  const [keyId, setKeyId] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function loadConnection() {
    setError(null);
    setConnection(null);
    paymentsApi.providerConnection().then((value) => {
      setConnection(value);
      setEnabled(value.enabled);
    }).catch((cause: unknown) => setError(cause instanceof PaymentsApiError ? cause.code : 'provider_status_unavailable'));
  }
  useEffect(() => { loadConnection(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const value = await paymentsApi.updateProviderConnection({
        enabled,
        ...(keyId ? { key_id: keyId } : {}),
        ...(apiSecret ? { api_secret: apiSecret } : {}),
        ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
      });
      setConnection(value);
      setKeyId('');
      setApiSecret('');
      setWebhookSecret('');
    } catch (cause) {
      setError(cause instanceof PaymentsApiError ? cause.code : 'provider_update_failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pay-panel" aria-labelledby="pay-provider-title">
      <div className="pay-panel-heading">
        <div>
          <p className="pay-eyebrow">Provider connection</p>
          <h2 id="pay-provider-title">Razorpay Test mode</h2>
        </div>
        <span className={connection?.configured ? 'pay-status pay-status-ready' : 'pay-status'}>
          {connection === null && !error ? 'Checking connection' : connection?.configured ? 'Credentials saved' : 'Not configured'}
        </span>
      </div>
      {error && !connection ? <ErrorState title="Could not load provider status." action={<Button size="compact" onClick={loadConnection}>Try again</Button>}>{error}</ErrorState> : null}
      {connection === null && !error ? <LoadingState title="Checking provider connection…" /> : null}
      {connection ? <div className="pay-provider-layout">
        <div>
          <p>Use Test-mode credentials only. Secrets are encrypted before storage and are never shown again.</p>
          <form className="pay-form" onSubmit={save}>
            <Field label="Test Key ID">{(props) => <Input {...props} value={keyId} onChange={(event) => setKeyId(event.target.value)} placeholder="rzp_test_…" autoComplete="off" />}</Field>
            <Field label="Test Key Secret">{(props) => <Input {...props} type="password" value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} placeholder="Leave blank to keep saved value" autoComplete="new-password" />}</Field>
            <Field label="Test webhook secret">{(props) => <Input {...props} type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} placeholder="Create this separately in Razorpay" autoComplete="new-password" />}</Field>
            <label className="pay-toggle">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              Mark this Test-mode connection ready for the future checkout integration
            </label>
            {error ? <InlineNotice tone="danger" title="Could not save provider settings.">{error}</InlineNotice> : null}
            <Button className="pay-button" variant="primary" type="submit" loading={saving} loadingLabel="Saving connection…">Save Test connection</Button>
          </form>
        </div>
        <aside className="pay-provider-context" aria-label="Provider connection readiness">
          <h3>Connection readiness</h3>
          <dl>
            <div><dt>Credentials</dt><dd>{connection?.configured ? 'Saved' : 'Not configured'}</dd></div>
            <div><dt>Webhook verification</dt><dd>Required before collection</dd></div>
            <div><dt>Checkout</dt><dd>Unavailable until verification</dd></div>
          </dl>
          <p>Test-mode setup is safe to prepare now. It does not enable customer payment collection.</p>
        </aside>
      </div> : null}
    </section>
  );
}
