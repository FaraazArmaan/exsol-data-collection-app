import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { marketingApi, type Audience, type Channel, SEND_CHANNELS, CHANNEL_LABELS } from '../shared/api';
import '../marketing.css';

export function CampaignComposePage({ slug }: { slug: string; perms: ReadonlySet<string> }) {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('<p>Hello!</p>');
  const [audience, setAudience] = useState<Audience>('all');
  const [channel, setChannel] = useState<Channel>('email');
  const [isAb, setIsAb] = useState(false);
  const [subjectB, setSubjectB] = useState('');
  const [abSplit, setAbSplit] = useState(50);
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
    if (isAb && !subjectB.trim()) { setError('A/B test needs a variant-B subject.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await marketingApi.createCampaign({
        name: name.trim(), subject: subject.trim(), body_html: bodyHtml, audience, channel,
        is_ab: isAb, subject_b: isAb ? subjectB.trim() : undefined, ab_split: isAb ? abSplit : undefined,
      });
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
          <p><label>Subject{isAb ? ' (variant A)' : ''}<br /><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="20% off this week" /></label></p>
          <div className="mkt-ab-toggle">
            <label><input type="checkbox" checked={isAb} onChange={(e) => setIsAb(e.target.checked)} /> A/B test the subject line</label>
          </div>
          {isAb && (
            <div className="mkt-ab-fields">
              <p><label>Subject (variant B)<br /><input value={subjectB} onChange={(e) => setSubjectB(e.target.value)} placeholder="Save 20% — this week only" /></label></p>
              <label>Split: {abSplit}% get variant A, {100 - abSplit}% get variant B<br />
                <input type="range" min={0} max={100} value={abSplit} onChange={(e) => setAbSplit(Number(e.target.value))} style={{ width: '100%' }} /></label>
            </div>
          )}
          <p><label>Channel<br />
            <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {SEND_CHANNELS.map((ch) => (
                <option key={ch} value={ch}>{CHANNEL_LABELS[ch]}{ch !== 'email' ? ' (mock)' : ''}</option>
              ))}
            </select></label></p>
          <p><label>Audience<br />
            <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
              <option value="all">All customers</option>
              <option value="recent_30d">Seen in last 30 days</option>
            </select></label></p>
          <div className="mkt-count">
            {count === null
              ? 'Counting audience…'
              : `${count} emailable customer${count === 1 ? '' : 's'} in this audience`}
            {channel !== 'email' && <><br /><span className="mkt-hint">{CHANNEL_LABELS[channel]} is a mock channel — sends are logged, not delivered. Reach depends on customers having a phone number.</span></>}
          </div>
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
