import { useEffect, useState } from 'react';
import { publicApi, PosApiError, type PublicReviews } from '../pos/shared/api';

// Public reviews + Q&A block for the catalog page. Lists approved entries and
// carries a submit form (rate-limited + honeypot server-side). Submissions land
// in the moderation queue, so the form shows a "pending" thanks rather than the
// new entry. Store-level by default; the customer may attach it to a product.

interface Props {
  slug: string;
  products: { id: string; name: string }[];
}

type Kind = 'review' | 'question';

function Stars({ n }: { n: number | null }) {
  if (n == null) return null;
  const r = Math.round(n);
  return <span className="cat-rev__stars" aria-label={`${n} of 5`}>{'★'.repeat(r)}{'☆'.repeat(5 - r)}</span>;
}

export default function StorefrontReviews({ slug, products }: Props) {
  const [data, setData] = useState<PublicReviews | null>(null);
  const [kind, setKind] = useState<Kind>('review');
  const [rating, setRating] = useState(5);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [productId, setProductId] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  function load() {
    publicApi.getReviews(slug).then(setData).catch(() => setData({ summary: { avgRating: null, reviewCount: 0 }, reviews: [], questions: [] }));
  }
  useEffect(load, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    setError(null);
    try {
      await publicApi.submitReview({
        slug,
        honeypot,
        kind,
        rating: kind === 'review' ? rating : undefined,
        authorName: name.trim(),
        authorEmail: email.trim() || undefined,
        body: body.trim(),
        productId: productId || undefined,
      });
      setState('done');
      setBody(''); setName(''); setEmail(''); setProductId('');
    } catch (err) {
      setError(err instanceof PosApiError ? err.code : 'network_error');
      setState('idle');
    }
  }

  const canSubmit = name.trim() !== '' && body.trim() !== '' && state !== 'sending';

  return (
    <section className="cat-rev" aria-label="Reviews and questions">
      <div className="cat-rev__head">
        <h2>Reviews &amp; Questions</h2>
        {data?.summary.avgRating != null && (
          <span className="cat-rev__summary">
            <Stars n={data.summary.avgRating} /> {data.summary.avgRating} · {data.summary.reviewCount} review{data.summary.reviewCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="cat-rev__cols">
        <div className="cat-rev__list">
          {!data ? (
            <p className="muted">Loading…</p>
          ) : data.reviews.length === 0 && data.questions.length === 0 ? (
            <p className="muted">No reviews yet — be the first.</p>
          ) : (
            <>
              {data.reviews.map((r) => (
                <div key={r.id} className="cat-rev__item">
                  <div className="cat-rev__meta"><Stars n={r.rating} /> <strong>{r.authorName}</strong>{r.productName && <span className="cat-rev__prod"> · {r.productName}</span>}</div>
                  <p>{r.body}</p>
                </div>
              ))}
              {data.questions.map((q) => (
                <div key={q.id} className="cat-rev__item cat-rev__item--q">
                  <div className="cat-rev__meta"><span className="cat-rev__qmark">Q</span> <strong>{q.authorName}</strong>{q.productName && <span className="cat-rev__prod"> · {q.productName}</span>}</div>
                  <p>{q.body}</p>
                  {q.answer && <p className="cat-rev__answer"><strong>Answer:</strong> {q.answer}</p>}
                </div>
              ))}
            </>
          )}
        </div>

        <form className="cat-rev__form" onSubmit={submit}>
          {state === 'done' ? (
            <div className="cat-rev__thanks">
              <p>Thanks! Your {kind} is awaiting moderation.</p>
              <button type="button" onClick={() => setState('idle')}>Write another</button>
            </div>
          ) : (
            <>
              <div className="cat-rev__kind">
                <button type="button" className={kind === 'review' ? 'is-active' : ''} onClick={() => setKind('review')}>Review</button>
                <button type="button" className={kind === 'question' ? 'is-active' : ''} onClick={() => setKind('question')}>Question</button>
              </div>
              {kind === 'review' && (
                <label>Rating
                  <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
                    {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
                  </select>
                </label>
              )}
              {products.length > 0 && (
                <label>Product (optional)
                  <select value={productId} onChange={(e) => setProductId(e.target.value)}>
                    <option value="">General</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              <label>Name
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label>Email (optional)
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
              </label>
              <label>{kind === 'review' ? 'Your review' : 'Your question'}
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} required />
              </label>
              {/* Honeypot — hidden from humans. */}
              <input name="website" value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
                tabIndex={-1} autoComplete="off" aria-hidden="true"
                style={{ position: 'absolute', left: '-10000px', opacity: 0, height: 0, pointerEvents: 'none' }} />
              {error && <p className="cat-rev__err">Couldn’t submit ({error}).</p>}
              <button className="cat-cta__btn" type="submit" disabled={!canSubmit}>
                {state === 'sending' ? 'Sending…' : 'Submit'}
              </button>
            </>
          )}
        </form>
      </div>
    </section>
  );
}
