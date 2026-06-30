import type { CSSProperties } from 'react';
import type { CategoryKey } from '../categories';
import { CATEGORY_KEYS, CATEGORY_LABELS } from '../categories';
import { CATEGORY_COLORS } from '../category-colors';

export type SortKey = 'newest' | 'oldest' | 'name' | 'size';

interface Props {
  selected: CategoryKey[];
  onChange: (next: CategoryKey[]) => void;
  search: string;
  onSearchChange: (s: string) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
}

export function FilterBar({ selected, onChange, search, onSearchChange, sort, onSortChange }: Props) {
  return (
    <>
      <div className="fm-toolbar">
        <input
          type="search"
          className="fm-search"
          placeholder="Search title or description…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <select
          className="fm-sort"
          aria-label="Sort"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name (A–Z)</option>
          <option value="size">Largest first</option>
        </select>
      </div>

      <div className="fm-filters">
        <span className="fm-filters__label">Categories</span>
        {CATEGORY_KEYS.map((c) => {
          const on = selected.includes(c);
          return (
            <button
              key={c} type="button"
              className={`fm-chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              style={{ '--chip-color': CATEGORY_COLORS[c] } as CSSProperties}
              onClick={() => onChange(on ? selected.filter((x) => x !== c) : [...selected, c])}
            >
              <span className="fm-chip__dot" />
              {CATEGORY_LABELS[c]}
            </button>
          );
        })}
        {selected.length > 0 && (
          <button type="button" className="fm-filters__clear" onClick={() => onChange([])}>Clear</button>
        )}
      </div>
    </>
  );
}
