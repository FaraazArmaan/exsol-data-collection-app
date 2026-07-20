import { type ReactNode } from 'react';
import { EmptyState, ErrorState, LoadingState } from './Feedback';

export function TableFrame({ caption, children, density = 'comfortable' }: { caption: string; children: ReactNode; density?: 'compact' | 'comfortable' }) {
  return <div className={`ui-table-frame ui-table-frame--${density}`}><table className="ui-table"><caption>{caption}</caption>{children}</table></div>;
}

export function SelectionBar({ count, children, onClear }: { count: number; children: ReactNode; onClear: () => void }) {
  if (count === 0) return null;
  return <section className="ui-selection-bar" aria-label={`${count} selected`}><strong>{count} selected</strong><div className="ui-selection-bar__actions">{children}<button type="button" className="ui-selection-bar__clear" onClick={onClear}>Clear selection</button></div></section>;
}

interface TableStateProps { title: string; children?: ReactNode; action?: ReactNode; }

export function TableLoadingState({ title = 'Loading records…', children }: Omit<TableStateProps, 'title' | 'action'> & { title?: string }) {
  return <LoadingState title={title}>{children}</LoadingState>;
}

export function TableEmptyState({ title, children, action }: TableStateProps) {
  return <EmptyState title={title} action={action}>{children}</EmptyState>;
}

export function TableErrorState({ title, children, action }: TableStateProps) {
  return <ErrorState title={title} action={action}>{children}</ErrorState>;
}
