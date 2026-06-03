// src/modules/ams/components/onboarding/steps/SuccessStep.tsx
import { Link } from 'react-router-dom';

interface Props {
  clientId: string;
  clientName: string;
  clientSlug: string;
  ownerTempPassword: string;
  ownerEmail: string;
  onClose: () => void;
}

export function SuccessStep({ clientId, clientName, clientSlug, ownerTempPassword, ownerEmail, onClose }: Props) {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>✓ Workspace created</h3>
      <p>
        <strong>{clientName}</strong> is ready. Share the Owner login details below.
      </p>

      <div className="card" style={{ padding: 12, marginTop: 12 }}>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Login URL</p>
        <code style={{ wordBreak: 'break-all' }}>{`${window.location.origin}/c/${clientSlug}/login`}</code>
      </div>
      <div className="card" style={{ padding: 12, marginTop: 8 }}>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Email</p>
        <code>{ownerEmail}</code>
      </div>
      <div className="card" style={{ padding: 12, marginTop: 8 }}>
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Temp password</p>
        <code style={{ fontFamily: 'monospace', fontSize: 14 }}>{ownerTempPassword}</code>
        <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          The Owner must change this on first login.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        <Link to={`/clients/${clientId}`} className="btn btn-primary" onClick={onClose}>Open workspace →</Link>
      </div>
    </div>
  );
}
