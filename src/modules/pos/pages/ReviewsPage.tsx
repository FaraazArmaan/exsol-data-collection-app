import { useEffect, useState } from 'react';
import { posApi, PosApiError, type StaffReview } from '../shared/api';

// Staff review/Q&A moderation queue (/c/:slug/pos/reviews). Approve/reject
// submissions and answer questions. Gated server-side by pos.history.viewAll;
// the RouteMount mirrors it.

type Filter = 'pending' | 'approved' | 'rejected';
const FILTERS: Filter[] = ['pending', 'approved', 'rejected'];

function Stars({ n }: { n: number | null }) {
  if (n == null) return null;
  return <span className="pos-reviews__stars" aria-label={`${n} of 5`}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>;
}

export default function ReviewsPage() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [rows, setRows] = useState<StaffReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  async function load(f: Filter) {
    setRows(null);
    try {
      const r = await posApi.listReviews(f);
      setRows(r.reviews);
    } catch (e) {
      setError(e instanceof PosApiError ? e.code : 'network_error');
    }
  }
  useEffect(() => { void load(filter); }, [filter]);

  async function moderate(r: StaffReview, status: 'approved' | 'rejected') {
    try {
      const answer = answers[r.id];
      await posApi.moderateReview(r.id, { status, ...(answer !== undefined ? { answer } : {}) });
      await load(filter);
    } catch (e) {
      setError(e instanceof PosApiError ? e.code : 'network_error');
    }
  }

  return (
    <div className="pos-reviews">
      <header className="pos-reviews__header">
        <h1>Reviews &amp; Questions</h1>
        <div className="pos-tabs" role="tablist">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
              {f[0]!.toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {error && <div className="err">Error: {error}</div>}

      {rows === null ? (
        <p className="pos-loading">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nothing {filter}.</p>
      ) : (
        <div className="pos-reviews__list">
          {rows.map((r) => (
            <div key={r.id} className="pos-reviews__item">
              <div className="pos-reviews__top">
                <span className={`pos-reviews__kind pos-reviews__kind--${r.kind}`}>{r.kind}</span>
                {r.kind === 'review' && <Stars n={r.rating} />}
                <strong>{r.authorName}</strong>
                {r.productName && <span className="pos-reviews__prod">on {r.productName}</span>}
                <span className="pos-reviews__date">{r.createdAt.slice(0, 10)}</span>
              </div>
              <p className="pos-reviews__body">{r.body}</p>

              {r.kind === 'question' && (
                <textarea
                  className="pos-reviews__answer"
                  placeholder="Answer (optional, shown publicly)…"
                  defaultValue={r.answer ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [r.id]: e.target.value }))}
                />
              )}

              <div className="pos-reviews__actions">
                {r.status !== 'approved' && (
                  <button className="pos-reviews__approve" onClick={() => moderate(r, 'approved')}>Approve</button>
                )}
                {r.status !== 'rejected' && (
                  <button className="pos-reviews__reject" onClick={() => moderate(r, 'rejected')}>Reject</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
