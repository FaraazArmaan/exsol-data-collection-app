import { useEffect, useState } from 'react';
import { financeApi } from '../shared/api';
import { CATEGORY_LABELS, type AiInsight, type FinanceCategory, type InsightSeverity } from '../shared/types';
import { formatMoney, monthLabel } from '../shared/format';
import { humanError } from './OverviewTab';

interface Props {
  month: string;
  perms: ReadonlySet<string>;
}

const SEVERITY_LABEL: Record<InsightSeverity, string> = { info: 'Info', warn: 'Watch', high: 'Alert' };

function healthBand(score: number): { label: string; cls: string } {
  if (score >= 70) return { label: 'Healthy', cls: 'fin-health-good' };
  if (score >= 40) return { label: 'Fair', cls: 'fin-health-fair' };
  return { label: 'At risk', cls: 'fin-health-poor' };
}

export function AiTab({ month, perms }: Props) {
  const [insight, setInsight] = useState<AiInsight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const canEdit = perms.has('finance.business.edit');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    financeApi.aiInsights(month)
      .then((d) => { if (alive) setInsight(d); })
      .catch((e) => { if (alive) { setInsight(null); setError(humanError(e)); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [month]);

  const regenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      setInsight(await financeApi.regenerateInsights(month));
    } catch (e) { setError(humanError(e)); } finally { setRegenerating(false); }
  };

  if (error) {
    return (
      <div className="fin-banner" role="alert">
        {error}
        <button className="fin-link" onClick={() => setError(null)}>dismiss</button>
      </div>
    );
  }

  if (loading || !insight) {
    return (
      <section className="fin-panel">
        <div className="fin-panel-header">AI insights</div>
        <p className="fin-muted fin-pad">Analysing {monthLabel(month)}…</p>
      </section>
    );
  }

  const band = healthBand(insight.health_score);
  const base = insight.base_currency;
  const fmt = (c: number) => formatMoney(c, base);

  return (
    <>
      {insight.is_fallback && (
        <div className="fin-note-banner" role="status">
          Showing a rule-based summary. Set <code>ANTHROPIC_API_KEY</code> for live AI analysis.
        </div>
      )}

      <section className="fin-panel" aria-label="AI insights">
        <div className="fin-panel-header fin-panel-header-row">
          <span>Insights — {monthLabel(month)}</span>
          {canEdit && (
            <button className="btn btn-secondary fin-add-btn" onClick={regenerate} disabled={regenerating}>
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
          )}
        </div>

        <div className="fin-ai-body">
          {/* Health score + narrative */}
          <div className="fin-ai-top">
            <div className={`fin-health ${band.cls}`}>
              <div className="fin-health-score">{insight.health_score}</div>
              <div className="fin-health-label">{band.label}</div>
            </div>
            <p className="fin-ai-narrative">{insight.narrative}</p>
          </div>

          {/* Anomalies */}
          <div className="fin-ai-anomalies">
            {insight.anomalies.map((an, i) => (
              <div key={i} className={`fin-anomaly fin-anomaly-${an.severity}`}>
                <div className="fin-anomaly-head">
                  <span className="fin-anomaly-sev">{SEVERITY_LABEL[an.severity]}</span>
                  <span className="fin-anomaly-title">{an.title}</span>
                </div>
                <p className="fin-anomaly-detail">{an.detail}</p>
              </div>
            ))}
          </div>

          {/* Facts the analysis is based on */}
          <div className="fin-ai-facts">
            <div><span className="fin-muted">Revenue</span><strong>{fmt(insight.facts.revenue_cents)}</strong></div>
            <div><span className="fin-muted">Expenses</span><strong>{fmt(insight.facts.expenses_cents)}</strong></div>
            <div>
              <span className="fin-muted">Net</span>
              <strong className={insight.facts.net_cents < 0 ? 'fin-danger' : ''}>{fmt(insight.facts.net_cents)}</strong>
            </div>
          </div>

          {insight.facts.expenses_by_category.length > 0 && (
            <div className="fin-ai-cats">
              <div className="fin-muted fin-ai-cats-head">Where the money went</div>
              {insight.facts.expenses_by_category.slice(0, 5).map((c) => (
                <div key={c.category} className="fin-ai-cat-row">
                  <span>{CATEGORY_LABELS[c.category as FinanceCategory] ?? c.category}</span>
                  <span className="fin-num">{fmt(c.cents)}</span>
                </div>
              ))}
            </div>
          )}

          <p className="fin-ai-meta fin-muted">
            {insight.is_fallback ? 'Rule-based' : `Model: ${insight.model}`}
            {' · '}Generated {new Date(insight.generated_at).toLocaleString()}
          </p>
        </div>
      </section>
    </>
  );
}
