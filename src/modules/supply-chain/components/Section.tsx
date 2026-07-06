import type { ReactNode } from 'react';

interface Props {
  title: string;
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}

export function Section({ title, loading, error, empty, emptyText, children }: Props) {
  return (
    <section className="sc-section">
      <h2 className="sc-section-title">{title}</h2>
      {loading && <div className="sc-state sc-loading">Loading…</div>}
      {!loading && error && (
        <div className="sc-state sc-error">Couldn't load {title.toLowerCase()} (error {error}).</div>
      )}
      {!loading && !error && empty && <div className="sc-state sc-empty">{emptyText}</div>}
      {!loading && !error && !empty && children}
    </section>
  );
}
