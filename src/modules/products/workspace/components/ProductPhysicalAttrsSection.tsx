type Patch = Partial<{
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  color: string | null;
  size: string | null;
  material: string | null;
  gender: string | null;
  age_group: string | null;
  manufacturer: string | null;
  country_of_origin: string | null;
}>;

export function ProductPhysicalAttrsSection(props: {
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  color: string | null;
  size: string | null;
  material: string | null;
  gender: string | null;
  age_group: string | null;
  manufacturer: string | null;
  country_of_origin: string | null;
  onChange: (patch: Patch) => void;
}) {
  const {
    length_mm, width_mm, height_mm,
    color, size, material, gender, age_group, manufacturer, country_of_origin,
    onChange,
  } = props;

  const numInput = (raw: string): number | null => {
    if (raw === '') return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  };

  return (
    <details className="pm-advanced-section">
      <summary>Physical attributes</summary>
      <div className="pm-advanced-grid">
        <div>
          <label htmlFor="pm-length">Length (mm)</label>
          <input
            id="pm-length"
            type="number"
            min="0"
            value={length_mm ?? ''}
            onChange={(e) => onChange({ length_mm: numInput(e.target.value) })}
          />
        </div>

        <div>
          <label htmlFor="pm-width">Width (mm)</label>
          <input
            id="pm-width"
            type="number"
            min="0"
            value={width_mm ?? ''}
            onChange={(e) => onChange({ width_mm: numInput(e.target.value) })}
          />
        </div>

        <div>
          <label htmlFor="pm-height">Height (mm)</label>
          <input
            id="pm-height"
            type="number"
            min="0"
            value={height_mm ?? ''}
            onChange={(e) => onChange({ height_mm: numInput(e.target.value) })}
          />
        </div>

        <div>
          <label htmlFor="pm-color">Color</label>
          <input
            id="pm-color"
            value={color ?? ''}
            maxLength={40}
            onChange={(e) => onChange({ color: e.target.value || null })}
          />
        </div>

        <div>
          <label htmlFor="pm-size">Size</label>
          <input
            id="pm-size"
            value={size ?? ''}
            maxLength={80}
            onChange={(e) => onChange({ size: e.target.value || null })}
          />
        </div>

        <div>
          <label htmlFor="pm-material">Material</label>
          <input
            id="pm-material"
            value={material ?? ''}
            maxLength={120}
            onChange={(e) => onChange({ material: e.target.value || null })}
          />
        </div>

        <div>
          <label htmlFor="pm-gender">Gender</label>
          <input
            id="pm-gender"
            value={gender ?? ''}
            maxLength={20}
            onChange={(e) => onChange({ gender: e.target.value || null })}
          />
        </div>

        <div>
          <label htmlFor="pm-age-group">Age group</label>
          <input
            id="pm-age-group"
            value={age_group ?? ''}
            maxLength={20}
            onChange={(e) => onChange({ age_group: e.target.value || null })}
          />
        </div>

        <div>
          <label htmlFor="pm-manufacturer">Manufacturer</label>
          <input
            id="pm-manufacturer"
            value={manufacturer ?? ''}
            maxLength={120}
            onChange={(e) => onChange({ manufacturer: e.target.value || null })}
          />
        </div>

        <div>
          <label htmlFor="pm-country">Country of origin</label>
          <input
            id="pm-country"
            value={country_of_origin ?? ''}
            maxLength={80}
            onChange={(e) => onChange({ country_of_origin: e.target.value || null })}
          />
        </div>
      </div>
    </details>
  );
}
