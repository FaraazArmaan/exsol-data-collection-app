import type { ProductType } from '../../shared/types';

export function ProductBasicsSection(props: {
  type: ProductType;
  name: string;
  description: string | null;
  onChange: (patch: Partial<{ type: ProductType; name: string; description: string | null }>) => void;
}) {
  return (
    <div className="pm-section">
      <h3>Basics</h3>

      <label>Type</label>
      <div className="pm-toggle" role="radiogroup" aria-label="Product type">
        {(['physical', 'service'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={props.type === t}
            className={props.type === t ? 'on' : ''}
            onClick={() => props.onChange({ type: t })}
          >
            {t === 'physical' ? 'Physical' : 'Service'}
          </button>
        ))}
      </div>

      <label htmlFor="pm-name">Name *</label>
      <input
        id="pm-name"
        value={props.name}
        maxLength={120}
        onChange={(e) => props.onChange({ name: e.target.value })}
      />

      <label htmlFor="pm-desc">Description</label>
      <textarea
        id="pm-desc"
        value={props.description ?? ''}
        onChange={(e) => props.onChange({ description: e.target.value || null })}
      />
    </div>
  );
}
