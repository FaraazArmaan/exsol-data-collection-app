import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { OnboardApiError, onboardCommit, onboardDryRun, validateOnboardToken } from './shared/api';
import type { DryRunResult, OnboardTenant } from './shared/types';

type Phase = 'validating' | 'invalid' | 'ready' | 'done';

function friendly(e: unknown): string {
  if (e instanceof OnboardApiError) {
    if (e.status === 410) return 'This link has expired or was already used.';
    if (e.status === 429) return 'Too many attempts — please wait a minute and try again.';
    if (e.code === 'file_required') return 'Please choose a CSV or XLSX file.';
    if (e.code === 'invalid_multipart') return 'That file could not be read. Try a CSV or XLSX export.';
  }
  return e instanceof Error ? e.message : String(e);
}

// Public /onboard/:token page. A guest (a new client) validates the link, uploads
// a CSV/XLSX, previews the parse (server-side), and commits — which imports the
// products and consumes the single-use token. Every state is handled.
export default function OnboardPage() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>('validating');
  const [tenant, setTenant] = useState<OnboardTenant | null>(null);
  const [invalidReason, setInvalidReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dry, setDry] = useState<DryRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState(0);

  useEffect(() => {
    let cancel = false;
    if (!token) { setPhase('invalid'); setInvalidReason('This onboarding link is invalid.'); return; }
    validateOnboardToken(token)
      .then((t) => { if (!cancel) { setTenant(t); setPhase('ready'); } })
      .catch((e) => {
        if (cancel) return;
        setPhase('invalid');
        setInvalidReason(
          e instanceof OnboardApiError && e.status === 410
            ? 'This onboarding link has already been used or has expired.'
            : 'This onboarding link is invalid.',
        );
      });
    return () => { cancel = true; };
  }, [token]);

  const pickFile = async (f: File | null) => {
    setFile(f);
    setDry(null);
    setError(null);
    if (!f || !token) return;
    setBusy(true);
    try { setDry(await onboardDryRun(token, f)); }
    catch (e) { setError(friendly(e)); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!file || !token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await onboardCommit(token, file);
      if (r.committed) { setCreatedCount(r.created ?? 0); setPhase('done'); }
      else setError('Some rows have errors — fix them and re-upload.');
    } catch (e) { setError(friendly(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="dc-shell">
      <div className="dc-card">
        {phase === 'validating' && <p className="dc-muted">Checking your link…</p>}

        {phase === 'invalid' && (
          <>
            <h1 className="dc-title">Link unavailable</h1>
            <p className="dc-muted">{invalidReason}</p>
          </>
        )}

        {phase === 'done' && (
          <>
            <h1 className="dc-title">All set 🎉</h1>
            <p className="dc-muted">
              Imported <strong>{createdCount}</strong> product{createdCount === 1 ? '' : 's'}
              {tenant ? ` for ${tenant.name}` : ''}. You can close this page.
            </p>
          </>
        )}

        {phase === 'ready' && (
          <>
            <h1 className="dc-title">Welcome{tenant ? `, ${tenant.name}` : ''}</h1>
            <p className="dc-muted">Upload a CSV or XLSX of your products to get started.</p>

            <label className="dc-file">
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                aria-label="Product file"
              />
            </label>

            {busy && !dry && <p className="dc-muted">Reading your file…</p>}

            {dry && (
              <div className="dc-preview">
                <p>
                  <strong>{dry.summary.to_create}</strong> product{dry.summary.to_create === 1 ? '' : 's'} ready to import
                  {dry.summary.errors > 0 ? <> · <span className="dc-err-count">{dry.summary.errors} row error{dry.summary.errors === 1 ? '' : 's'}</span></> : null}
                  {' '}(of {dry.summary.total} rows)
                </p>
                {dry.errors.length > 0 && (
                  <ul className="dc-errors">
                    {dry.errors.slice(0, 20).map((er, i) => (
                      <li key={i}>Row {er.row}{er.field ? ` · ${er.field}` : ''} — {er.message}</li>
                    ))}
                    {dry.errors.length > 20 && <li>…and {dry.errors.length - 20} more</li>}
                  </ul>
                )}
              </div>
            )}

            {error && <div className="dc-error" role="alert">{error}</div>}

            <button
              type="button"
              className="btn btn-primary dc-submit"
              disabled={busy || !dry || dry.summary.to_create === 0 || dry.summary.errors > 0}
              onClick={commit}
            >
              {busy && dry ? 'Importing…' : `Import ${dry?.summary.to_create ?? 0} products`}
            </button>
            {dry && dry.summary.errors > 0 && (
              <p className="dc-muted dc-hint">Fix the flagged rows and re-upload before importing.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
