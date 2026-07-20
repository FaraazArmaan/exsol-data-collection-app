import { type ReactNode } from 'react';

type FeedbackTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface StateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function InlineNotice({ tone = 'info', title, children, action }: StateProps & { tone?: FeedbackTone }) {
  return (
    <section className={`ui-notice ui-notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div><strong>{title}</strong>{children && <div className="ui-notice__copy">{children}</div>}</div>
      {action && <div className="ui-notice__action">{action}</div>}
    </section>
  );
}

export function LoadingState({ title = 'Loading…', children }: Omit<StateProps, 'action' | 'title'> & { title?: string }) {
  return <section className="ui-state ui-state--loading" aria-busy="true" aria-live="polite"><span className="ui-state__spinner" aria-hidden /><div><strong>{title}</strong>{children && <p>{children}</p>}</div></section>;
}

export function EmptyState({ title, children, action }: StateProps) {
  return <section className="ui-state ui-state--empty"><div><strong>{title}</strong>{children && <p>{children}</p>}</div>{action && <div>{action}</div>}</section>;
}

export function ErrorState({ title, children, action }: StateProps) {
  return <section className="ui-state ui-state--danger" role="alert"><div><strong>{title}</strong>{children && <p>{children}</p>}</div>{action && <div>{action}</div>}</section>;
}

export function PermissionState({ title = 'You do not have access to this action.', children, action }: Omit<StateProps, 'title'> & { title?: string }) {
  return <section className="ui-state ui-state--permission"><div><strong>{title}</strong>{children && <p>{children}</p>}</div>{action && <div>{action}</div>}</section>;
}
