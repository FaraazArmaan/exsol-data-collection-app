import { useCallback, useEffect, useState } from 'react';
import { warehouseApi } from '../../shared/api';
import type { SlottingStatus, SlottingSuggestion } from '../../shared/types';
import { Button } from '../../../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../../../components/ui/Feedback';

interface Props {
  perms: ReadonlySet<string>;
}

// AI slotting: data-driven move candidates (from movement velocity + where stock
// sits) with an AI-written rationale. Nothing moves until a human applies a
// suggestion — apply runs a real transfer; dismiss archives it.
export default function AiSlottingTab({ perms }: Props) {
  const [suggestions, setSuggestions] = useState<SlottingSuggestion[] | null>(null);
  const [status, setStatus] = useState<SlottingStatus>('pending');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canDecide = perms.has('warehouse.products.edit');

  const load = useCallback((s: SlottingStatus) => {
    setError(null);
    warehouseApi.slottingList(s)
      .then((r) => setSuggestions(r.suggestions))
      .catch((e) => { setSuggestions([]); setError(e instanceof Error ? e.message : String(e)); });
  }, []);

  useEffect(() => { load(status); }, [load, status]);

  const onGenerate = async () => {
    setError(null);
    setNotice(null);
    setSuggestions(null);
    try {
      const r = await warehouseApi.slottingGenerate();
      setNotice(
        r.created === 0
          ? 'No slotting moves to suggest right now — stock is already well-placed or there is no store location.'
          : `${r.created} suggestion${r.created === 1 ? '' : 's'} generated${r.ai_fallback ? ' (AI preview — set ANTHROPIC_API_KEY for live rationale)' : ''}.`,
      );
      setStatus('pending');
      load('pending');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      load(status);
    }
  };

  const decide = async (id: string, action: 'apply' | 'dismiss') => {
    setBusyId(id);
    setError(null);
    try {
      await warehouseApi.slottingDecide({ suggestion_id: id, action });
      load(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="wh-actions wh-actions-end">
        <div className="wh-segmented" role="tablist" aria-label="Suggestion status">
          {(['pending', 'applied', 'dismissed'] as SlottingStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              className={`wh-segment${status === s ? ' wh-segment-active' : ''}`}
              onClick={() => { setSuggestions(null); setStatus(s); }}
            >
              {s[0]!.toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        {canDecide && (
          <button type="button" className="btn btn-primary" onClick={onGenerate}>Generate suggestions</button>
        )}
      </div>

      {notice && <div className="wh-notice" role="status">{notice}</div>}
      {error && <ErrorState title="Slotting suggestions could not load" action={<Button variant="secondary" onClick={() => load(status)}>Try again</Button>}>{error}</ErrorState>}

      {suggestions === null ? (
        <LoadingState title="Loading slotting suggestions" />
      ) : suggestions.length === 0 ? (
        <EmptyState title={status === 'pending'
            ? 'No pending suggestions. Generate to analyse movement history and current placement.'
            : `No ${status} suggestions.`} />
      ) : (
        <ul className="wh-card-list">
          {suggestions.map((s) => (
            <li key={s.id} className="wh-card">
              <div className="wh-card-head">
                <span className="wh-card-title">
                  Move <strong>{s.suggested_qty}</strong> × {s.product_name}
                </span>
                <span className="wh-badge">{s.velocity} moved / 90d</span>
              </div>
              <p className="wh-card-move">
                {s.from_name} <span aria-hidden>→</span> {s.to_name}
              </p>
              <p className="wh-card-rationale">
                {s.rationale}
                {s.ai_fallback && <span className="wh-ai-tag"> · AI preview</span>}
              </p>
              {status === 'pending' && canDecide && (
                <div className="wh-card-actions">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === s.id} onClick={() => decide(s.id, 'dismiss')}>
                    Dismiss
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busyId === s.id} onClick={() => decide(s.id, 'apply')}>
                    {busyId === s.id ? 'Applying…' : 'Apply move'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
