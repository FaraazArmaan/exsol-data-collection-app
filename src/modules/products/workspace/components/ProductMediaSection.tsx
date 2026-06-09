import { useEffect, useMemo, useState } from 'react';
import type { ProductImage } from '../../shared/types';
import { ProductImageGallery } from './ProductImageGallery';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 20;

export function ProductMediaSection(props: {
  productId: string | null;
  images: ProductImage[];
  heroKey: string | null;
  pendingImages: File[];
  onPendingImagesChange: (files: File[]) => void;
  onChange: () => Promise<void>;
}) {
  if (props.productId) {
    return (
      <div className="pm-section">
        <h3>Media</h3>
        <ProductImageGallery
          productId={props.productId}
          images={props.images}
          heroKey={props.heroKey}
          onChange={props.onChange}
        />
      </div>
    );
  }
  return <PendingMediaUploader files={props.pendingImages} onChange={props.onPendingImagesChange} />;
}

function PendingMediaUploader(props: { files: File[]; onChange: (files: File[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  const previews = useMemo(
    () => props.files.map((f) => ({ file: f, url: URL.createObjectURL(f) })),
    [props.files],
  );
  useEffect(() => {
    return () => { previews.forEach((p) => URL.revokeObjectURL(p.url)); };
  }, [previews]);

  function addFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setError(null);
    const incoming: File[] = [];
    for (const f of Array.from(picked)) {
      if (!ALLOWED_MIME.includes(f.type)) { setError(`Unsupported file type: ${f.name}`); continue; }
      if (f.size > MAX_BYTES)             { setError(`Too large (${(f.size / 1_048_576).toFixed(1)}MB): ${f.name}`); continue; }
      incoming.push(f);
    }
    if (incoming.length === 0) return;
    const merged = [...props.files, ...incoming].slice(0, MAX_IMAGES);
    if (props.files.length + incoming.length > MAX_IMAGES) {
      setError(`Image cap is ${MAX_IMAGES}; some were dropped.`);
    }
    props.onChange(merged);
  }

  function remove(idx: number) {
    const next = [...props.files];
    next.splice(idx, 1);
    props.onChange(next);
  }

  return (
    <div className="pm-section">
      <h3>Media</h3>
      <p className="pm-muted">Images will upload when the product is saved.</p>
      {error && <p className="pm-error" role="alert">{error}</p>}
      <input
        type="file"
        accept={ALLOWED_MIME.join(',')}
        multiple
        onChange={(e) => addFiles(e.target.files)}
        disabled={props.files.length >= MAX_IMAGES}
      />
      {previews.length > 0 && (
        <div className="pm-img-row" role="list" aria-label="Pending images">
          {previews.map((p, idx) => (
            <div key={p.url} role="listitem" className="pm-img-tile" title={p.file.name}>
              <img className="pm-thumb" style={{ width: '100%', height: '100%' }} src={p.url} alt="" />
              <button
                type="button"
                className="pm-img-x"
                aria-label="Remove image"
                onClick={() => remove(idx)}
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
