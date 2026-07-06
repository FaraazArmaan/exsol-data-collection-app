import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { marketingApi, type Audience } from '../shared/api';

export function CampaignComposePage({ slug }: { slug: string; perms: ReadonlySet<string> }) {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('<p>Hello!</p>');
  const [audience, setAudience] = useState<Audience>('all');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setCount(null);
    marketingApi.audienceCount(audience).then((r) => { if (live) setCount(r.count); }).catch(() => { if (live) setCount(null); });
    return () => { live = false; };
  }, [audience]);

  async function saveDraft() {
    if (!name.trim() || !subject.trim() || !bodyHtml.trim()) { setError('Name, subject and body are required.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await marketingApi.createCampaign({ name: name.trim(), subject: subject.trim(), body_html: bodyHtml, audience });
      nav(`/c/${slug}/marketing/${r.campaign.id}`);
    } catch { setError('Could not save the campaign.'); setBusy(false); }
  }

  return (
    <div className="page">
      <Link to={`/c/${slug}/marketing`}>← Campaigns</Link>
      <h1 className="page-title">New campaign</h1>
      {error && <div className="error">{error}</div>}
      <div className="mkt-compose">
        <div>
          <label>Name<br /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring promo" /></label>
          <p><label>Subject<br /><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="20% off this week" /></label></p>
          <p><label>Audience<br />
            <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
              <option value="all">All customers</option>
              <option value="recent_30d">Seen in last 30 days</option>
            </select></label></p>
          <div className="mkt-count">{count === null ? 'Counting audience…' : `${count} emailable customer${count === 1 ? '' : 's'} will receive this`}</div>
          <p><label>Body (HTML)<br /><textarea rows={10} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} style={{ width: '100%' }} /></label></p>
          <button className="btn" onClick={saveDraft} disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
        </div>
        <div>
          <div className="muted">Preview</div>
          <div className="mkt-preview" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        </div>
      </div>
    </div>
  );
}
