import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { marketingApi, type SocialPost } from '../shared/api';
import { SOCIAL_PROVIDERS, PROVIDER_LABELS, PROVIDER_MAX_CHARS, type SocialProvider } from '../lib/social';
import { dateTime } from '../format';
import { MarketingNav } from './MarketingNav';
import '../marketing.css';

export function SocialSchedulerPage({ slug, perms }: { slug: string; perms: ReadonlySet<string> }) {
  const [posts, setPosts] = useState<SocialPost[] | null>(null);
  const [provider, setProvider] = useState<SocialProvider>('facebook');
  const [content, setContent] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canCreate = perms.has('marketing.customers.create');
  const canEdit = perms.has('marketing.customers.edit');
  const max = PROVIDER_MAX_CHARS[provider];
  const over = content.length > max;

  async function load() {
    try { setError(null); setPosts((await marketingApi.socialPosts()).posts); }
    catch { setError('Could not load scheduled posts.'); setPosts([]); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function schedule() {
    if (!content.trim() || !when || over) return;
    try {
      await marketingApi.scheduleSocial(provider, content.trim(), new Date(when).toISOString());
      setContent(''); setWhen('');
      await load();
    } catch { setError('Could not schedule the post.'); }
  }

  async function postNow(id: string) {
    try { await marketingApi.postSocialNow(id); await load(); } catch { setError('Could not post.'); }
  }
  async function cancel(id: string) {
    try { await marketingApi.cancelSocial(id); await load(); } catch { setError('Could not cancel.'); }
  }

  const badge = useMemo(() => (s: SocialPost['status']) => <span className="mkt-status">{s}</span>, []);

  return (
    <div className="page">
      <h1 className="page-title">Social scheduler</h1>
      <MarketingNav slug={slug} active="social" />
      <p className="muted">Compose and schedule posts. Providers are mock seams — posts are simulated until live keys are connected.</p>
      {error && <div className="error">{error}</div>}

      {canCreate && (
        <section className="mkt-wh-section">
          <div className="mkt-social-compose">
            <div className="mkt-inline-form">
              <select value={provider} onChange={(e) => setProvider(e.target.value as SocialProvider)}>
                {SOCIAL_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
              </select>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="What's happening at Papa's Saloon?" style={{ width: '100%' }} />
            <div className="mkt-count">
              <span className={over ? 'mkt-over' : ''}>{content.length} / {max}</span>
              <button className="btn" onClick={schedule} disabled={!content.trim() || !when || over} style={{ marginLeft: 12 }}>Schedule</button>
            </div>
          </div>
        </section>
      )}

      {posts === null && <div className="muted">Loading…</div>}
      {posts !== null && posts.length === 0 && <div className="pm-empty">No scheduled posts yet.</div>}
      {posts !== null && posts.length > 0 && (
        <table className="pm-table">
          <thead><tr><th>Provider</th><th>Content</th><th>Scheduled</th><th>Status</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
                <td>{PROVIDER_LABELS[p.provider]}</td>
                <td className="mkt-social-content">{p.content}{p.error ? <><br /><span className="mkt-over">{p.error}</span></> : null}</td>
                <td>{dateTime(p.scheduled_for)}</td>
                <td>{badge(p.status)}</td>
                {canEdit && (
                  <td>
                    {p.status === 'scheduled' && <>
                      <button className="btn btn-sm" onClick={() => postNow(p.id)}>Post now</button>
                      <button className="btn btn-sm" onClick={() => cancel(p.id)} style={{ marginLeft: 6 }}>Cancel</button>
                    </>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
