import type { CSSProperties } from 'react';
import type { CategoryKey } from '../categories';
import { CATEGORY_LABELS } from '../categories';
import { CATEGORY_COLORS } from '../category-colors';

interface Props {
  category: CategoryKey;
  onRemove?: () => void;
}

export function CategoryChip({ category, onRemove }: Props) {
  return (
    <span className="fm-cat" style={{ '--chip-color': CATEGORY_COLORS[category] } as CSSProperties}>
      <span className="fm-cat__dot" />
      {CATEGORY_LABELS[category]}
      {onRemove && (
        <button
          type="button"
          className="fm-cat__x"
          onClick={onRemove}
          aria-label={`Remove ${CATEGORY_LABELS[category]}`}
        >×</button>
      )}
    </span>
  );
}
