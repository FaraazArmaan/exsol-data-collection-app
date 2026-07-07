import { useState, useEffect } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { Co2Response, Co2Factor } from '../shared/types';
import { fetchCo2, upsertCo2Factor } from '../shared/api';
import { Section } from './Section';
import { CHART_FILL, AXIS_STROKE, GRID_STROKE } from '../format';

export function Co2Section() {
  const [data, setData] = useState<Co2Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchCo2()
      .then((d) => {
        setData(d);
        const drafts: Record<string, string> = {};
        for (const f of d.factors) {
          drafts[f.id] = String(f.kgPerUnit);
        }
        setDraftValues(drafts);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(factor: Co2Factor) {
    const raw = draftValues[factor.id];
    const val = parseFloat(raw ?? '');
    if (isNaN(val) || val < 0) return;
    setSaving(factor.id);
    setSaveError(null);
    try {
      await upsertCo2Factor({ categoryId: factor.categoryId, kgPerUnit: val });
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          factors: prev.factors.map((f) => f.id === factor.id ? { ...f, kgPerUnit: val } : f),
        };
      });
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
      // Restore the draft to the last committed value so the input doesn't show stale data
      setDraftValues((prev) => ({ ...prev, [factor.id]: String(factor.kgPerUnit) }));
    } finally {
      setSaving(null);
    }
  }

  const empty = !!data && data.factors.length === 0 && data.byPo.length === 0;

  return (
    <Section
      title="CO₂ Emissions"
      loading={loading}
      error={error}
      empty={empty}
      emptyText="No CO₂ factors configured yet."
    >
      {data && (
        <>
          <h3 className="sc-co2-subtitle">Emission Factors (kg CO₂ / unit)</h3>
          <table className="sc-table sc-co2-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>kg CO₂ / unit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.factors.map((f) => (
                <tr key={f.id}>
                  <td>{f.categoryName}</td>
                  <td>
                    <input
                      className="sc-co2-input"
                      type="number"
                      min="0"
                      step="0.001"
                      value={draftValues[f.id] ?? String(f.kgPerUnit)}
                      onChange={(e) => setDraftValues((prev) => ({ ...prev, [f.id]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button
                      className="sc-co2-save-btn"
                      disabled={saving === f.id}
                      onClick={() => handleSave(f)}
                    >
                      {saving === f.id ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {saveError && (
            <div className="sc-state sc-error" style={{ color: 'var(--danger)', marginTop: 4 }}>
              Save failed: {saveError}
            </div>
          )}

          {data.byPo.length > 0 && (
            <>
              <h3 className="sc-co2-subtitle">Per-PO CO₂ Estimates</h3>
              <table className="sc-table sc-co2-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Expected</th>
                    <th>kg CO₂</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byPo.map((po) => (
                    <tr key={po.poId}>
                      <td>{po.supplier}</td>
                      <td>{po.expectedOn ?? '—'}</td>
                      <td>{po.kgCo2.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3 className="sc-co2-subtitle">30-Day CO₂ Trend</h3>
          <div className="sc-chart" style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={data.trend} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="day" stroke={AXIS_STROKE} tick={{ fontSize: 10 }} interval={4} />
                <YAxis stroke={AXIS_STROKE} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="kgCo2" fill={CHART_FILL} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Section>
  );
}
