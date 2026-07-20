import { type ReactNode } from 'react';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function StatusBadge({ icon, label, tone = 'neutral' }: { icon: ReactNode; label: string; tone?: StatusTone }) {
  return <span className={`ui-status ui-status--${tone}`}><span className="ui-status__icon" aria-hidden="true">{icon}</span><span>{label}</span></span>;
}
