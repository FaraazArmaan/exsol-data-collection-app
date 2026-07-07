import { useEffect, useState } from 'react';
import { hrApi } from '../shared/api';
import type { HrDashboard } from '../shared/types';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

export default function DashboardTab() {
  const [data, setData] = useState<HrDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    setData(null);
    hrApi.dashboard()
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError((e as { code?: string })?.code ?? 'load_failed'); });
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <div className="hr-state hr-state-error" role="alert">
        Couldn't load the dashboard ({error}).{' '}
        <button className="btn btn-ghost" onClick={() => location.reload()}>Retry</button>
      </div>
    );
  }
  if (!data) return <div className="hr-state">Loading dashboard…</div>;
  if (data.totalHeadcount === 0) {
    return (
      <div className="hr-state hr-empty">
        <strong>No people yet.</strong>
        <span>Add team members in Manage Team to populate HR analytics.</span>
      </div>
    );
  }

  return (
    <div className="hr-dash">
      <div className="hr-cards">
        <div className="hr-card"><div className="hr-card-value">{data.totalHeadcount}</div><div className="hr-card-label">Headcount</div></div>
        <div className="hr-card"><div className="hr-card-value">{data.joins.last30}</div><div className="hr-card-label">Joins · 30d</div></div>
        <div className="hr-card"><div className="hr-card-value">{data.exits.last30}</div><div className="hr-card-label">Exits · 30d</div></div>
        <div className="hr-card"><div className="hr-card-value">{data.workforce.hours}</div><div className="hr-card-label">Hours logged · 30d</div></div>
      </div>

      <section className="hr-dash-section">
        <h2 className="hr-dash-title">Headcount by role &amp; level</h2>
        <table className="hr-table">
          <thead><tr><th>Role</th><th>Level</th><th className="hr-num">People</th></tr></thead>
          <tbody>
            {data.headcount.map((r, i) => (
              <tr key={i}>
                <td><span className="hr-node-dot" style={{ background: r.role_color || 'var(--accent)' }} /> {r.role_label ?? '—'}</td>
                <td>{r.level_label ?? (r.level_number != null ? `L${r.level_number}` : 'Unassigned')}</td>
                <td className="hr-num">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="hr-cols">
        <section className="hr-dash-section">
          <h2 className="hr-dash-title">Recent joins</h2>
          {data.joins.recent.length === 0 ? (
            <div className="hr-state hr-empty"><span>No recent joins.</span></div>
          ) : (
            <ul className="hr-list">
              {data.joins.recent.map((j) => (
                <li key={j.id}><span>{j.display_name}</span><span className="hr-list-meta">{j.role_label ?? '—'} · {fmtDate(j.created_at)}</span></li>
              ))}
            </ul>
          )}
        </section>
        <section className="hr-dash-section">
          <h2 className="hr-dash-title">Recent exits</h2>
          {data.exits.recent.length === 0 ? (
            <div className="hr-state hr-empty"><span>No recent exits. Completed offboarding appears here.</span></div>
          ) : (
            <ul className="hr-list">
              {data.exits.recent.map((x) => (
                <li key={x.id}><span>{x.subject_name}</span><span className="hr-list-meta">{fmtDate(x.completed_at)}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="hr-dash-note">
        Hours logged is from Workforce timesheets. Dedicated leave / absence tracking is a Workforce follow-up (no leave table exists yet).
      </p>
    </div>
  );
}
