import { useState } from 'react';
import { useUserAuth } from '../user-portal/user-auth-context';
import { useProductsScope } from '../products/shared/scope';
import { generateOnboardingLink, OnboardApiError } from './shared/api';

// Rendered inside the SHARED Product Manager, which runs in two trees: the
// workspace (has UserAuthProvider) and the admin Product Manager
// (/clients/:clientId/products — NO UserAuthProvider). Generating an onboarding
// link is a workspace-owner action (needs a bucket-user session), so it doesn't
// apply in admin mode — and useUserAuth() would crash there. Gate on the scope
// mode BEFORE the inner (which reads useUserAuth) is ever mounted.
export function OnboardingLinkButton() {
  const scope = useProductsScope();
  if (scope.mode === 'admin') return null;
  return <OnboardingLinkButtonInner />;
}

// Self-gates: only shows when the data-collection module is enabled AND the caller
// can create (Owner all-on, or the explicit key).
function OnboardingLinkButtonInner() {
  const { user, permissions, enabledModules } = useUserAuth();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isOwner = !!user && (user.level_number == null || user.level_number === 1);
  const enabled = enabledModules.some((m) => m.key === 'data-collection');
  const canGenerate = enabled && (isOwner || permissions['data-collection.products.create'] === true);
  if (!canGenerate) return null;

  const generate = async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await generateOnboardingLink();
      setLink(`${window.location.origin}/onboard/${r.token}`);
    } catch (e) {
      setError(e instanceof OnboardApiError ? `Could not generate link (${e.status})` : 'Could not generate link');
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!link) return;
    void navigator.clipboard?.writeText(link);
    setCopied(true);
  };

  return (
    <div className="dc-genlink">
      <button type="button" className="btn btn-secondary" onClick={generate} disabled={busy}>
        {busy ? 'Generating…' : 'Generate onboarding link'}
      </button>
      {error && <span className="dc-genlink__err" role="alert">{error}</span>}
      {link && (
        <span className="dc-genlink__out">
          <input
            readOnly
            value={link}
            className="dc-genlink__input"
            aria-label="Onboarding link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="dc-link" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </span>
      )}
    </div>
  );
}
