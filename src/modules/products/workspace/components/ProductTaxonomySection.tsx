type Patch = Partial<{
  google_category: string | null;
  meta_category: string | null;
  hsn_code: string | null;
  gst_rate: number | null;
  product_url: string | null;
}>;

export function ProductTaxonomySection(props: {
  google_category: string | null;
  meta_category: string | null;
  hsn_code: string | null;
  // Neon returns NUMERIC as string ('5.00'). Accept either at the boundary.
  gst_rate: number | string | null;
  product_url: string | null;
  onChange: (patch: Patch) => void;
}) {
  const {
    google_category, meta_category, hsn_code, gst_rate, product_url,
    onChange,
  } = props;

  return (
    <details className="pm-advanced-section">
      <summary>Categorization &amp; tax</summary>
      <div className="pm-advanced-grid">
        <div>
          <label htmlFor="pm-google-category">Google category</label>
          <input
            id="pm-google-category"
            value={google_category ?? ''}
            onChange={(e) => onChange({ google_category: e.target.value || null })}
          />
        </div>

        <div>
          <label htmlFor="pm-meta-category">Meta category</label>
          <input
            id="pm-meta-category"
            value={meta_category ?? ''}
            onChange={(e) => onChange({ meta_category: e.target.value || null })}
          />
        </div>

        <div>
          <label htmlFor="pm-hsn">HSN code</label>
          <input
            id="pm-hsn"
            value={hsn_code ?? ''}
            onChange={(e) => onChange({ hsn_code: e.target.value || null })}
          />
        </div>

        <div>
          <label htmlFor="pm-gst">GST rate (%)</label>
          <input
            id="pm-gst"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={gst_rate == null ? '' : String(gst_rate)}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                onChange({ gst_rate: null });
                return;
              }
              const n = Number(raw);
              onChange({ gst_rate: Number.isFinite(n) ? n : null });
            }}
          />
        </div>

        <div>
          <label htmlFor="pm-product-url">Product URL</label>
          <input
            id="pm-product-url"
            value={product_url ?? ''}
            onChange={(e) => onChange({ product_url: e.target.value || null })}
          />
        </div>
      </div>
    </details>
  );
}
