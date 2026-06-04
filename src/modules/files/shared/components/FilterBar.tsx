import type { CategoryKey } from '../categories';
import { CATEGORY_KEYS, CATEGORY_LABELS } from '../categories';

interface Props {
  selected: CategoryKey[];
  onChange: (next: CategoryKey[]) => void;
}

export function FilterBar({ selected, onChange }: Props) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0' }}>
      <span style={{ fontSize: 12, color: '#888' }}>Categories:</span>
      {CATEGORY_KEYS.map((c) => {
        const on = selected.includes(c);
        return (
          <button
            key={c} type="button"
            onClick={() => onChange(on ? selected.filter((x) => x !== c) : [...selected, c])}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 12,
              background: on ? '#2c5f2d' : '#1a1a1a',
              color: on ? '#fff' : '#888',
              border: 'none', cursor: 'pointer',
            }}
          >{CATEGORY_LABELS[c]}</button>
        );
      })}
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange([])} style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>Clear</button>
      )}
    </div>
  );
}
