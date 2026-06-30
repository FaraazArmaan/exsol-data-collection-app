import { useEffect, useState } from 'react';
import { useUserAuth } from '../../user-portal/user-auth-context';

// L1 Owner self-serve toggle for the public storefront (spec §6.9). Reads the
// current state on mount and flips it via PATCH /api/client-settings/storefront.
// Self-gated to Owners (or holders of _platform.settings.edit). Mounted on a
// POS route for now; can move into a workspace-settings page when one exists.
export default function StorefrontSettings() {
  const { user, permissions } = useUserAuth();
  const canEdit = !!user && (
    user.level_number == null || user.level_number === 1 ||
    permissions['_platform.settings.edit'] === true
  );

  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canEdit) { setLoading(false); return; }
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/client-settings/storefront', { credentials: 'include' });
        const d = await r.json();
        if (!cancel && r.ok) { setEnabled(!!d.enabled); setUrl(d.publicUrl ?? ''); }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [canEdit]);

  async function toggle(next: boolean) {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/client-settings/storefront', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const d = await r.json();
      if (r.ok) { setEnabled(!!d.enabled); setUrl(d.publicUrl ?? ''); }
      else setError(d?.error?.code ?? 'error');
    } catch {
      setError('network_error');
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) return <p className="muted">You don’t have access to storefront settings.</p>;
  if (loading) return <p className="muted">Loading…</p>;

  return (
    <section className="storefront-settings page-narrow">
      <h1 className="page-title">Public Storefront</h1>
      <p className="muted">Let customers browse your menu and place pickup/delivery orders online. You take payment when they collect.</p>

      <button
        type="button" role="switch" aria-checked={enabled} aria-label="Public storefront"
        className="toggle" disabled={busy} onClick={() => toggle(!enabled)}
      >
        <span className="toggle-label toggle-label-on">ON</span>
        <span className="toggle-label toggle-label-off">OFF</span>
        <span className="toggle-knob" />
      </button>

      {error && <p className="error">Couldn’t save ({error}).</p>}

      {enabled && url && (
        <p style={{ marginTop: 16 }}>
          Your storefront link: <code>{url}</code>{' '}
          <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(url)}>Copy</button>
        </p>
      )}
    </section>
  );
}
