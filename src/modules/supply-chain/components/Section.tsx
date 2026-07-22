import type { ReactNode } from 'react';
import { Button } from '../../../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../../../components/ui/Feedback';

interface Props {
  title: string;
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
  onRetry?: () => void;
}

export function Section({ title, loading, error, empty, emptyText, children, onRetry }: Props) {
  return (
    <section className="sc-section">
      <h2 className="sc-section-title">{title}</h2>
      {loading && <LoadingState title={`Loading ${title.toLowerCase()}`} />}
      {!loading && error && (
        <ErrorState title={`${title} could not load`} action={onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}>{error}</ErrorState>
      )}
      {!loading && !error && empty && <EmptyState title={emptyText} />}
      {!loading && !error && !empty && children}
    </section>
  );
}
