import { FormEvent, useEffect, useState } from 'react';
import { PaymentsApiError, paymentsApi } from '../shared/api';
import type { PaymentProviderConnection } from '../shared/types';

export default function PaymentProviderSettingsCard() {
  const [connection, setConnection] = useState<PaymentProviderConnection | null>(null);
  const [keyId, setKeyId] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    paymentsApi.providerConnection().then((value) => {
      setConnection(value);
      setEnabled(value.enabled);
    }).catch((cause: unknown) => setError(cause instanceof PaymentsApiError ? cause.code : 'provider_status_unavailable'));
  }, []);

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
          {connection?.configured ? 'Credentials saved' : 'Not configured'}
        </span>
      </div>
      <p>Use Test-mode credentials only. Secrets are encrypted before storage and are never shown again.</p>
      <form className="pay-form" onSubmit={save}>
        <label>Test Key ID
          <input value={keyId} onChange={(event) => setKeyId(event.target.value)} placeholder="rzp_test_…" autoComplete="off" />
        </label>
        <label>Test Key Secret
          <input type="password" value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} placeholder="Leave blank to keep saved value" autoComplete="new-password" />
        </label>
        <label>Test webhook secret
          <input type="password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} placeholder="Create this separately in Razorpay" autoComplete="new-password" />
        </label>
        <label className="pay-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Mark this Test-mode connection ready for the future checkout integration
        </label>
        {error ? <p className="pay-error">Could not save provider settings: {error}.</p> : null}
        <button className="pay-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Test connection'}</button>
      </form>
    </section>
  );
}
