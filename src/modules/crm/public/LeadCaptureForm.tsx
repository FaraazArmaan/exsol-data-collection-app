import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { crmApi } from '../shared/api';
import '../crm.css';

// PUBLIC, unauthenticated lead form at /c/:slug/lead (sibling of the booking
// storefront). Posts to the rate-limited + honeypot-guarded lead-submit endpoint.
export default function LeadCaptureForm() {
  const { slug = '' } = useParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || (!email.trim() && !phone.trim())) {
      setError('Enter your name and an email or phone.');
      return;
    }
    setState('sending');
    setError(null);
    try {
      await crmApi.submitLead({
        slug,
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        message: message.trim() || undefined,
        honeypot,
      });
      setState('done');
    } catch {
      setState('idle');
      setError('Could not send. Please try again.');
    }
  }

  if (state === 'done') {
    return (
      <div className="crm-public">
        <div className="crm-public-ok">✓ Thanks! We’ll be in touch soon.</div>
      </div>
    );
  }

  return (
    <div className="crm-public">
      <h1>Get in touch</h1>
      <p className="crm-public-sub">Leave your details and we’ll reach out.</p>
      <form onSubmit={submit}>
        <label className="crm-public-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label className="crm-public-field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="crm-public-field">
          <span>Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </label>
        <label className="crm-public-field">
          <span>Message <em className="muted">(optional)</em></span>
          <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>

        {/* Honeypot — hidden from humans; bots that fill every field trip it. */}
        <input
          className="crm-hp" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true"
          value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
        />

        {error && <p className="crm-public-field" style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
