import { useState } from 'react';
import type { BriefResponse } from '../shared/types';
import { fetchBrief } from '../shared/api';

export function BriefSection() {
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function generate() {
    setLoading(true);
    setError(null);
    fetchBrief()
      .then(setBrief)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  return (
    <section className="sc-section">
      <h2 className="sc-section-title">AI Brief</h2>
      {loading && <div className="sc-state sc-loading">Generating…</div>}
      {!loading && error && (
        <div className="sc-brief-error">
          <span className="sc-state sc-error">Could not generate brief (error {error}).</span>
          <button className="sc-btn-secondary sc-brief-btn" onClick={generate}>
            Retry
          </button>
        </div>
      )}
      {!loading && !error && !brief && (
        <div className="sc-brief-idle">
          <p className="sc-brief-intro">
            Generate a narrative summary of your current supply-chain state.
          </p>
          <button className="sc-btn-primary sc-brief-btn" onClick={generate}>
            Generate brief
          </button>
        </div>
      )}
      {!loading && !error && brief && (
        <div className="sc-brief-result">
          <pre className="sc-brief-text">{brief.brief}</pre>
          {brief.fallback && (
            <p className="sc-brief-fallback-note">Demo preview (no AI key configured)</p>
          )}
          <div className="sc-brief-footer">
            <button className="sc-btn-secondary sc-brief-btn" onClick={generate}>
              Regenerate
            </button>
            <span className="sc-brief-model">{brief.model}</span>
          </div>
        </div>
      )}
    </section>
  );
}
