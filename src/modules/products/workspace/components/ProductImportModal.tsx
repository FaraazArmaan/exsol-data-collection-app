import { useState } from 'react';
import { productsApi } from '../../shared/api';
import { useProductsScope } from '../../shared/scope';
import type { ImportDryRun } from '../../shared/types';

export function ProductImportModal(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState<ImportDryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { queryParam: clientQuery } = useProductsScope();

  if (!props.open) return null;

  function reset() {
    setFile(null);
    setDryRun(null);
    setError(null);
  }

  async function pickFile(picked: File | null) {
    reset();
    setFile(picked);
    if (!picked) return;
    setBusy(true);
    try {
      const result = await productsApi.importDryRun(picked, { clientId: clientQuery });
      setDryRun(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file || !dryRun || dryRun.errors.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await productsApi.importCommit(file, { clientId: clientQuery });
      reset();
      props.onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const blocked = (dryRun?.errors.length ?? 0) > 0;
  const applyCount = (dryRun?.summary.to_create ?? 0) + (dryRun?.summary.to_update ?? 0);

  return (
    <div
      className="pm-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
    >
      <div className="pm-modal" role="dialog" aria-modal="true" aria-labelledby="pm-import-title">
        <div className="pm-modal-header">
          <h3 id="pm-import-title">Import Products</h3>
          <button type="button" onClick={props.onClose} aria-label="Close">✕</button>
        </div>

        <div className="pm-modal-body">
          <p className="pm-muted" style={{ marginTop: 0 }}>
            Upload a CSV or XLSX file. Existing products are matched by SKU
            and updated in place; new SKUs are created. Missing categories
            are created automatically.
          </p>

          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
          />

          {busy && <p className="pm-muted">Validating…</p>}
          {error && <div className="pm-error" role="alert">{error}</div>}

          {dryRun && (
            <div className="pm-import-result">
              <div className="pm-summary">
                <span>Create: <b>{dryRun.summary.to_create}</b></span>
                <span>Update: <b>{dryRun.summary.to_update}</b></span>
                <span className={dryRun.summary.errors > 0 ? 'pm-bad' : ''}>
                  Errors: <b>{dryRun.summary.errors}</b>
                </span>
                <span>Warnings: <b>{dryRun.summary.warnings}</b></span>
              </div>

              {dryRun.errors.length > 0 && (
                <ul className="pm-errors">
                  {dryRun.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>Row {e.row} · <code>{e.field}</code> · {e.message}</li>
                  ))}
                  {dryRun.errors.length > 50 && (
                    <li>…and {dryRun.errors.length - 50} more</li>
                  )}
                </ul>
              )}

              {dryRun.warnings.length > 0 && (
                <ul className="pm-warnings">
                  {dryRun.warnings.slice(0, 50).map((w, i) => (
                    <li key={i}>Row {w.row} · {w.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="pm-modal-footer">
          <button type="button" onClick={props.onClose}>Cancel</button>
          <button
            type="button"
            className="pm-primary"
            disabled={!dryRun || blocked || busy || applyCount === 0}
            onClick={commit}
          >
            {blocked
              ? 'Fix errors to apply'
              : applyCount === 0
                ? 'Nothing to apply'
                : `Apply ${applyCount} change${applyCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
